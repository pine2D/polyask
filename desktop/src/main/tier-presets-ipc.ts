import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { SiteKey } from '../shared/contracts';
import type { OperationGate } from '../shared/operation-gate';
import { presetKey, isPresetSite, isPresetName, isTierPreset, normalizeTierPresetResult, sameTierPreset,
  type TierPresetAction, type TierPresetResult } from '../shared/tier-presets';
import type { PreferenceRuntime } from './preference-runtime';

interface Options {
  readonly ipc: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly gate: OperationGate;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly blocked: () => boolean;
  readonly epoch: () => number;
  readonly preferences: Pick<PreferenceRuntime, 'snapshot' | 'set'>;
  readonly inspect: (site: SiteKey, action: TierPresetAction, deadline: number) => Promise<TierPresetResult>;
}
const CHANNELS = ['polyask:tier-preset-options', 'polyask:tier-preset-current', 'polyask:tier-preset-save'] as const;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request');
  return value as Record<string, unknown>;
};
const siteOf = (site: unknown): SiteKey => { if (!isPresetSite(site)) throw new Error('invalid_request'); return site; };

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
  async function inspect(site: SiteKey, action: TierPresetAction) {
    const epoch = options.epoch(), deadline = Date.now() + 10000;
    const result = normalizeTierPresetResult(await options.inspect(site, action, deadline));
    if (!alive || options.blocked() || epoch !== options.epoch()) throw new Error('source_changed');
    if (Date.now() >= deadline) throw new Error('timeout');
    if (!result.ok) throw new Error(result.code);
    return result;
  }
  async function readOptions(site: SiteKey, model: unknown) {
    if (model !== undefined && !isPresetName(model)) throw new Error('invalid_request');
    const result = await inspect(site, { kind: 'options', ...(model === undefined ? {} : { model }) });
    if (!result.catalog || result.catalog.model !== (model ?? result.current.model)) throw new Error('invalid_response');
    return result.catalog;
  }
  async function save(site: SiteKey, value: unknown) {
    const v = object(value);
    if (Object.keys(v).length !== 2 || (v.mode !== 'fast' && v.mode !== 'think') ||
      (v.preset !== null && !isTierPreset(v.preset))) throw new Error('invalid_request');
    const key = presetKey(site, v.mode), before = options.preferences.snapshot();
    if (v.preset !== null) {
      const result = await inspect(site, { kind: 'verify', preset: v.preset });
      if (!result.verified || !sameTierPreset(result.verified, v.preset)) throw new Error('invalid_response');
      const after = options.preferences.snapshot();
      if (after.deviceId !== before.deviceId || JSON.stringify(after.versions[key]) !== JSON.stringify(before.versions[key]))
        throw new Error('source_changed');
    }
    return options.preferences.set(key, v.preset);
  }
  handle(CHANNELS[0], async value => {
    const v = object(value);
    if (Object.keys(v).some(key => key !== 'site' && key !== 'model')) throw new Error('invalid_request');
    return readOptions(siteOf(v.site), v.model);
  });
  handle(CHANNELS[1], async site => (await inspect(siteOf(site), { kind: 'current' })).current);
  handle(CHANNELS[2], async value => {
    const { site, ...choice } = object(value);
    return save(siteOf(site), choice);
  });
  return () => { alive = false; for (const channel of CHANNELS) options.ipc.removeHandler(channel); };
}
