import type { SiteKey } from '../shared/contracts';
import { PRESET_KEYS, presetKey, type SitePresetKey, type TierPreset } from '../shared/tier-presets';
import type { Tier } from '../shared/protocol';

type Values = Partial<Record<SitePresetKey, TierPreset | null>>;
/** 在操作第一次 await 前固定两档；同步拉取和后续编辑不能改变本次发送或内部重试。 */
export function captureTierPresets(values?: Values): (site: SiteKey, mode: Tier) => TierPreset | undefined {
  const saved = Object.fromEntries(PRESET_KEYS.map(key => [key, values?.[key] ? { ...values[key] } : null])) as Values;
  return (site, mode) => {
    const preset = mode ? saved[presetKey(site, mode)] : null;
    return preset ? { ...preset } : undefined;
  };
}
