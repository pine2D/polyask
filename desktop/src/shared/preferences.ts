import { SITE_KEYS, type SiteKey } from "./contracts";
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from "./display";
import { isProxyPreference } from "./proxy-preference";
import type { SiteZoomPreferences } from "./site-zoom";
import { validSyncTime, type VersionedSyncValue } from "./sync";

export type PreferenceKey = "completionNotifications" | "density" | "siteScale" | "layoutMode" |
  "workbenchGuide" | ConfirmationKey | `siteZoom.${SiteKey}` | "proxy";
/** 可「不再提示」的确认：值为 false 表示用户选了不再提示。不归组，始终随同步跨设备生效。 */
export type ConfirmationKey = "sitePageCloseConfirm" | "newSessionConfirm";
export const CONFIRMATION_KEYS: readonly ConfirmationKey[] = ["sitePageCloseConfirm", "newSessionConfirm"];
/**
 * proxy 只登记键与组：让同步投影、state 前缀和快照的 following 认得它。值不进 PreferenceValues，
 * 读写一律经 main/proxy-preference-store；通用写入路径（repository / preferences IPC）显式拒收。
 */
export type PreferenceGroup = "display" | "layout" | "siteZoom" | "proxy";
export type GeneralPreferenceGroup = Exclude<PreferenceGroup, "proxy">;
export type WorkbenchGuideState = null | { readonly version: 1; readonly disposition: "dismissed" | "completed" };

export interface PreferenceValues {
  readonly completionNotifications: boolean;
  readonly display: DisplayPreferences;
  readonly layoutMode: "overview" | "focus";
  readonly siteZoom: SiteZoomPreferences;
  readonly workbenchGuide: WorkbenchGuideState;
  readonly sitePageCloseConfirm: boolean;
  readonly newSessionConfirm: boolean;
}

export interface PreferenceSnapshot {
  readonly values: PreferenceValues;
  readonly following: Record<PreferenceGroup, boolean>;
  readonly draftSync: boolean;
  readonly initialized: readonly PreferenceKey[];
  readonly deviceId: string;
  readonly versions: Partial<Record<PreferenceKey, Pick<VersionedSyncValue, "updatedAt" | "deviceId">>>;
}

/** 设备级跟随与覆盖只管通用组；proxy 的跟随标志与覆盖在独立 meta 键（proxyFollowing / proxyOverride）。 */
export interface DevicePreferences {
  readonly following: Record<GeneralPreferenceGroup, boolean>;
  readonly overrides: Partial<Record<PreferenceKey, unknown>>;
}

export const DEVICE_PREFERENCES_KEY = "devicePreferences";
export const PREFERENCE_SETTING_PREFIX = "polyask.preference.";
export const PREFERENCE_STATE_PREFIX = "preference:";
export const GENERAL_PREFERENCE_GROUPS: readonly GeneralPreferenceGroup[] = ["display", "layout", "siteZoom"];
export const PREFERENCE_GROUPS: readonly PreferenceGroup[] = [...GENERAL_PREFERENCE_GROUPS, "proxy"];
export const PREFERENCE_KEYS: readonly PreferenceKey[] = [
  "completionNotifications", "density", "siteScale", "layoutMode", "workbenchGuide", ...CONFIRMATION_KEYS,
  ...SITE_KEYS.map(site => `siteZoom.${site}` as const), "proxy"
];
export const DEFAULT_PREFERENCE_VALUES: PreferenceValues = {
  completionNotifications: false,
  display: DEFAULT_DISPLAY_PREFERENCES,
  layoutMode: "overview",
  siteZoom: {},
  workbenchGuide: null,
  sitePageCloseConfirm: true,
  newSessionConfirm: true
};

export function isPreferenceKey(value: unknown): value is PreferenceKey {
  return typeof value === "string" && PREFERENCE_KEYS.includes(value as PreferenceKey);
}

export function preferenceGroup(key: PreferenceKey): PreferenceGroup | null {
  if (key === "proxy") return "proxy";
  if (key === "density" || key === "siteScale") return "display";
  if (key === "layoutMode") return "layout";
  return key.startsWith("siteZoom.") ? "siteZoom" : null;
}

export function isPreferenceValue(key: PreferenceKey, value: unknown): boolean {
  if (!isPreferenceKey(key)) return false;
  if (key === "proxy") return isProxyPreference(value);
  if (key === "completionNotifications" || CONFIRMATION_KEYS.includes(key as ConfirmationKey)) return typeof value === "boolean";
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
