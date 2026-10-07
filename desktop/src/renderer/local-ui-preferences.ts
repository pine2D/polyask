import { DEFAULT_DISPLAY_PREFERENCES, parseDisplayPreferences, type DisplayPreferences } from '../shared/display';

export const LOCAL_UI_STORAGE_KEY = 'polyask.display';
export interface LocalUiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface WorkbenchGuidePreference {
  readonly version: 1;
  readonly disposition: 'dismissed' | 'completed';
}
export interface LocalUiPreferences {
  readonly display: DisplayPreferences;
  readonly workbenchGuide: WorkbenchGuidePreference | null;
}
export function parseWorkbenchGuidePreference(value: unknown): WorkbenchGuidePreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && (candidate.disposition === 'dismissed' || candidate.disposition === 'completed')
    ? { version: 1, disposition: candidate.disposition } : null;
}
function decode(raw: string | null, fallback: DisplayPreferences): LocalUiPreferences {
  let value: unknown = null;
  try { if (raw !== null) value = JSON.parse(raw); } catch { /* Damaged local UI preferences use safe defaults. */ }
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return { display: parseDisplayPreferences(object) ?? fallback,
    workbenchGuide: parseWorkbenchGuidePreference(object?.workbenchGuide) };
}
export function readLocalUiPreferences(storage: LocalUiStorage, fallback = DEFAULT_DISPLAY_PREFERENCES): LocalUiPreferences {
  try { return decode(storage.getItem(LOCAL_UI_STORAGE_KEY), fallback); }
  catch { return { display: fallback, workbenchGuide: null }; }
}
function update(storage: LocalUiStorage, fallback: DisplayPreferences,
  change: (current: LocalUiPreferences) => LocalUiPreferences): boolean {
  try {
    const next = change(decode(storage.getItem(LOCAL_UI_STORAGE_KEY), fallback));
    storage.setItem(LOCAL_UI_STORAGE_KEY, JSON.stringify({ ...next.display,
      ...(next.workbenchGuide ? { workbenchGuide: next.workbenchGuide } : {}) }));
    return true;
  } catch { return false; }
}
export function writeDisplayPreferences(storage: LocalUiStorage, value: unknown): boolean {
  const display = parseDisplayPreferences(value);
  return display ? update(storage, display, current => ({ ...current, display })) : false;
}
export function writeWorkbenchGuidePreference(storage: LocalUiStorage, value: WorkbenchGuidePreference | null,
  fallback = DEFAULT_DISPLAY_PREFERENCES): boolean {
  const workbenchGuide = value === null ? null : parseWorkbenchGuidePreference(value);
  if (value !== null && !workbenchGuide) return false;
  return update(storage, fallback, current => ({ ...current, workbenchGuide }));
}
