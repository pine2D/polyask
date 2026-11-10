import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { OperationGate } from '../shared/operation-gate';
import { claudePresetKey, isPresetName, isTierPreset, normalizeTierPresetResult, sameTierPreset,
  type TierPresetAction, type TierPresetResult } from '../shared/tier-presets';
import type { PreferenceRuntime } from './preference-runtime';

interface Options {
  readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly gate: OperationGate;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly blocked: () => boolean;
  readonly epoch: () => number;
  readonly preferences: Pick<PreferenceRuntime, 'snapshot' | 'set'>;
  readonly inspect: (action: TierPresetAction, deadline: number) => Promise<TierPresetResult>;
}
const CHANNELS = ['polyask:claude-preset-options', 'polyask:claude-preset-current', 'polyask:claude-preset-save'] as const;

/** 预设写入的唯一外壳入口：先验证网页精确组合并恢复，再保存；普通 preference-set 不能绕过。 */
export function registerTierPresetsIpc(options: Options): () => void {
  let alive = true;
  const handle = (channel: typeof CHANNELS[number], action: (value: unknown) => Promise<unknown>) => {
    options.ipc.handle(channel, async (event, value: unknown) => {
      if (!options.trusted(event)) throw new Error('untrusted_sender');
      if (!alive || options.blocked()) throw new Error('preset_busy');
      return options.gate.run(() => action(value));
    });
  };
  async function inspect(action: TierPresetAction) {
    const epoch = options.epoch(), deadline = Date.now() + 10000;
    const result = normalizeTierPresetResult(await options.inspect(action, deadline));
    if (!alive || options.blocked() || epoch !== options.epoch()) throw new Error('source_changed');
    if (Date.now() >= deadline) throw new Error('timeout');
    if (!result.ok) throw new Error(result.code);
    return result;
  }
  handle(CHANNELS[0], async model => {
    if (model !== undefined && !isPresetName(model)) throw new Error('invalid_request');
    const result = await inspect({ kind: 'options', ...(model === undefined ? {} : { model }) });
    if (!result.catalog || result.catalog.model !== (model ?? result.current.model)) throw new Error('invalid_response');
    return result.catalog;
  });
  handle(CHANNELS[1], async value => {
    if (value !== undefined) throw new Error('invalid_request');
    return (await inspect({ kind: 'current' })).current;
  });
  handle(CHANNELS[2], async value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
    const v = value as Record<string, unknown>;
    if (Object.keys(v).length !== 2 || (v.mode !== 'fast' && v.mode !== 'think') ||
      (v.preset !== null && !isTierPreset(v.preset))) throw new Error('invalid_request');
    const key = claudePresetKey(v.mode), before = options.preferences.snapshot();
    if (v.preset !== null) {
      const result = await inspect({ kind: 'verify', preset: v.preset });
      if (!result.verified || !sameTierPreset(result.verified, v.preset)) throw new Error('invalid_response');
      const after = options.preferences.snapshot();
      if (after.deviceId !== before.deviceId || JSON.stringify(after.versions[key]) !== JSON.stringify(before.versions[key]))
        throw new Error('source_changed');
    }
    return options.preferences.set(key, v.preset);
  });
  return () => { alive = false; for (const channel of CHANNELS) options.ipc.removeHandler(channel); };
}
