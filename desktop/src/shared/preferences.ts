import { SITE_KEYS, type SiteKey } from "./contracts";
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from "./display";
import type { SiteZoomPreferences } from "./site-zoom";
import { validSyncTime, type VersionedSyncValue } from "./sync";

export type PreferenceKey = "completionNotifications" | "density" | "siteScale" | "layoutMode" |
  "workbenchGuide" | `siteZoom.${SiteKey}`;
export type PreferenceGroup = "display" | "layout" | "siteZoom";
export type WorkbenchGuideState = null | { readonly version: 1; readonly disposition: "dismissed" | "completed" };

export interface PreferenceValues {
  readonly completionNotifications: boolean;
  readonly display: DisplayPreferences;
  readonly layoutMode: "overview" | "focus";
  readonly siteZoom: SiteZoomPreferences;
  readonly workbenchGuide: WorkbenchGuideState;
}

export interface PreferenceSnapshot {
  readonly values: PreferenceValues;
  readonly following: Record<PreferenceGroup, boolean>;
  readonly draftSync: boolean;
  readonly initialized: readonly PreferenceKey[];
  readonly deviceId: string;
  readonly versions: Partial<Record<PreferenceKey, Pick<VersionedSyncValue, "updatedAt" | "deviceId">>>;
}

export interface DevicePreferences {
  readonly following: Record<PreferenceGroup, boolean>;
  readonly overrides: Partial<Record<PreferenceKey, unknown>>;
}

export const DEVICE_PREFERENCES_KEY = "devicePreferences";
export const PREFERENCE_SETTING_PREFIX = "polyask.preference.";
export const PREFERENCE_STATE_PREFIX = "preference:";
export const PREFERENCE_GROUPS: readonly PreferenceGroup[] = ["display", "layout", "siteZoom"];
export const PREFERENCE_KEYS: readonly PreferenceKey[] = [
  "completionNotifications", "density", "siteScale", "layoutMode", "workbenchGuide",
  ...SITE_KEYS.map(site => `siteZoom.${site}` as const)
];
export const DEFAULT_PREFERENCE_VALUES: PreferenceValues = {
  completionNotifications: false,
  display: DEFAULT_DISPLAY_PREFERENCES,
  layoutMode: "overview",
  siteZoom: {},
  workbenchGuide: null
};

export function isPreferenceKey(value: unknown): value is PreferenceKey {
  return typeof value === "string" && PREFERENCE_KEYS.includes(value as PreferenceKey);
}

export function preferenceGroup(key: PreferenceKey): PreferenceGroup | null {
  if (key === "density" || key === "siteScale") return "display";
  if (key === "layoutMode") return "layout";
  return key.startsWith("siteZoom.") ? "siteZoom" : null;
}

export function isPreferenceValue(key: PreferenceKey, value: unknown): boolean {
  if (!isPreferenceKey(key)) return false;
  if (key === "completionNotifications") return typeof value === "boolean";
  if (key === "density") return value === "compact" || value === "comfortable";
  if (key === "siteScale") return value === 0.9 || value === 1;
  if (key === "layoutMode") return value === "overview" || value === "focus";
  if (key === "workbenchGuide") {
    if (value === null) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const guide = value as Record<string, unknown>;
    return Object.keys(guide).length === 2 && guide.version === 1 &&
      (guide.disposition === "dismissed" || guide.disposition === "completed");
  }
  return typeof value === "number" && Number.isFinite(value) && value >= 0.25 && value <= 5;
}

export function isVersionedPreference(key: PreferenceKey, value: unknown): value is VersionedSyncValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).every(field => ["value", "updatedAt", "deviceId"].includes(field)) &&
    Object.hasOwn(candidate, "value") && isPreferenceValue(key, candidate.value) &&
    validSyncTime(candidate.updatedAt) && typeof candidate.deviceId === "string" &&
    candidate.deviceId.length > 0 && candidate.deviceId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(candidate.deviceId);
}
