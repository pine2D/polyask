import type { SiteKey } from '../shared/contracts';
import { claudePresetKey, type ClaudePresetKey, type TierPreset } from '../shared/tier-presets';
import type { Tier } from '../shared/protocol';

type Values = Partial<Record<ClaudePresetKey, TierPreset | null>>;
/** 在操作第一次 await 前固定两档；同步拉取和后续编辑不能改变本次发送或内部重试。 */
export function captureTierPresets(values?: Values): (site: SiteKey, mode: Tier) => TierPreset | undefined {
  const fast = values?.claudeFastPreset, think = values?.claudeThinkPreset;
  const saved = { claudeFastPreset: fast ? { ...fast } : null, claudeThinkPreset: think ? { ...think } : null };
  return (site, mode) => {
    const preset = site === 'claude' && mode ? saved[claudePresetKey(mode)] : null;
    return preset ? { ...preset } : undefined;
  };
}
