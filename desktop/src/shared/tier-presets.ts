import { SITE_KEYS, type SiteKey } from './contracts';
/** 精确两维选择；仅模式站点的 model 是模式标签，目录说明各维语义且不持久化。 */
export interface TierPreset { readonly model: string; readonly effort: string | null }
export type PresetMode = 'fast' | 'think';
export type SitePresetKey = `${SiteKey}${'Fast' | 'Think'}Preset`;
export const presetKey = (site: SiteKey, mode: PresetMode): SitePresetKey => `${site}${mode === 'fast' ? 'Fast' : 'Think'}Preset`;
export const PRESET_KEYS = SITE_KEYS.flatMap(site => [presetKey(site, 'fast'), presetKey(site, 'think')]);
export const isSitePresetKey = (value: unknown): value is SitePresetKey => PRESET_KEYS.some(key => key === value);
export const isPresetSite = (value: unknown): value is SiteKey => SITE_KEYS.some(site => site === value);
export const DEFAULT_TIER_PRESETS = Object.fromEntries(PRESET_KEYS.map(key => [key, null])) as Record<SitePresetKey, null>;
export const CLAUDE_PRESET_KEYS = ['claudeFastPreset', 'claudeThinkPreset'] as const;
export type ClaudePresetKey = typeof CLAUDE_PRESET_KEYS[number];
export const claudePresetKey = (mode: PresetMode): ClaudePresetKey => mode === 'fast' ? 'claudeFastPreset' : 'claudeThinkPreset';
export const isClaudePresetKey = (value: unknown): value is ClaudePresetKey =>
  CLAUDE_PRESET_KEYS.some(key => key === value);

export function isPresetName(value: unknown, limit = 48): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value &&
    !/[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value);
}
export function isTierPreset(value: unknown): value is TierPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && isPresetName(v.model) && (v.effort === null || isPresetName(v.effort, 24));
}
export function sameTierPreset(left: TierPreset | null, right: TierPreset | null): boolean {
  return left === right || (!!left && !!right && left.model === right.model && left.effort === right.effort);
}
export function presetLabel(preset: TierPreset): string {
  return preset.effort ? `${preset.model} · ${preset.effort}` : preset.model;
}
export interface TierPresetCatalog {
  readonly models: readonly string[];
  readonly model: string;
  readonly efforts: readonly string[];
  readonly current: TierPreset;
  readonly primary?: 'model' | 'mode' | 'feature';
  readonly secondary?: 'effort' | 'mode' | 'toggle';
}
export type TierPresetAction = { readonly kind: 'current' } | { readonly kind: 'options'; readonly model?: string } |
  { readonly kind: 'verify'; readonly preset: TierPreset };
export const PRESET_CODES = ['not_ready', 'no_view', 'timeout', 'invalid_response',
  'preset_unavailable', 'preset_restore_failed', 'preset_busy', 'preset_model_switch_required'] as const;
export type PresetCode = typeof PRESET_CODES[number];
export type TierPresetResult = { readonly ok: true; readonly current: TierPreset;
  readonly catalog?: TierPresetCatalog; readonly verified?: TierPreset } | { readonly ok: false; readonly code: PresetCode };

export function isTierPresetAction(value: unknown): value is TierPresetAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>, keys = Object.keys(v);
  if (v.kind === 'current') return keys.length === 1;
  if (v.kind === 'verify') return keys.length === 2 && isTierPreset(v.preset);
  return v.kind === 'options' && keys.every(key => key === 'kind' || key === 'model') &&
    (v.model === undefined || isPresetName(v.model));
}
export function normalizeTierPresetResult(value: unknown): TierPresetResult {
  const invalid: TierPresetResult = { ok: false, code: 'invalid_response' };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
  const v = value as Record<string, unknown>;
  if (v.ok === false) return PRESET_CODES.some(code => code === v.code) ? { ok: false, code: v.code as PresetCode } : invalid;
  if (v.ok !== true || !isTierPreset(v.current) || (v.verified !== undefined && !isTierPreset(v.verified))) return invalid;
  let catalog: TierPresetCatalog | undefined;
  if (v.catalog !== undefined) {
    if (!v.catalog || typeof v.catalog !== 'object' || Array.isArray(v.catalog)) return invalid;
    const c = v.catalog as Record<string, unknown>;
    const names = (a: unknown, count: number, length: number): a is string[] => Array.isArray(a) &&
      a.length <= count && a.every(name => isPresetName(name, length)) && new Set(a).size === a.length;
    if (!names(c.models, 50, 48) || !c.models.length || !names(c.efforts, 12, 24) || !isPresetName(c.model) ||
      !c.models.includes(c.model) || !isTierPreset(c.current) || !sameTierPreset(c.current, v.current) ||
      c.primary !== undefined && !['model', 'mode', 'feature'].includes(c.primary as string) ||
      c.secondary !== undefined && !['effort', 'mode', 'toggle'].includes(c.secondary as string)) return invalid;
    catalog = { models: [...c.models], model: c.model, efforts: [...c.efforts], current: { ...c.current },
      ...(c.primary === undefined ? {} : { primary: c.primary as TierPresetCatalog['primary'] }),
      ...(c.secondary === undefined ? {} : { secondary: c.secondary as TierPresetCatalog['secondary'] }) };
  }
  return { ok: true, current: { ...v.current }, ...(catalog ? { catalog } : {}),
    ...(isTierPreset(v.verified) ? { verified: { ...v.verified } } : {}) };
}
