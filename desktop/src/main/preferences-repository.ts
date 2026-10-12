import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import { parseDisplayPreferences } from "../shared/display";
import {
  DEFAULT_PREFERENCE_VALUES, DEVICE_PREFERENCES_KEY, GENERAL_PREFERENCE_GROUPS, isPreferenceKey, isPreferenceValue,
  isVersionedPreference, PREFERENCE_KEYS, PREFERENCE_STATE_PREFIX, preferenceGroup,
  type DevicePreferences, type GeneralPreferenceGroup, type PreferenceGroup, type PreferenceKey,
  type PreferenceSnapshot, type PreferenceValues
} from "../shared/preferences";
import { nextSyncTime, type VersionedSyncValue } from "../shared/sync";
import type { MetaRepository } from "./meta-repository";
/** 只读来展示：非布尔值按 false（运行时另按损坏阻断）。 */
import { PROXY_FOLLOWING_KEY } from "./proxy-preference-store";
import type { StateRepository } from "./state-repository";

type PreferenceEntries = Partial<Record<PreferenceKey, unknown>>;
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
/** proxy 只借用 state 前缀与同步投影；值、跟随标志、本机覆盖都归 proxy-preference-store，这里一律不写（spec §3.4）。 */
const GENERAL_KEYS = PREFERENCE_KEYS.filter(key => key !== "proxy");

function generalGroup(key: PreferenceKey): GeneralPreferenceGroup | null {
  const group = preferenceGroup(key);
  if (group === "proxy") throw new Error("invalid_preference");
  return group;
}

export class PreferencesRepository {
  private readonly now: () => number;
  private readonly deviceId: () => string;

  constructor(private readonly state: StateRepository, private readonly meta: MetaRepository,
    options: { readonly now?: () => number; readonly deviceId?: () => string } = {}) {
    this.now = options.now ?? Date.now;
    this.deviceId = options.deviceId ?? (() => {
      const id = this.meta.get<unknown>("deviceId");
      if (typeof id !== "string" || !id) throw new Error("device_id_missing");
      return id;
    });
  }

  snapshot(defaults: Partial<PreferenceValues> = {}): PreferenceSnapshot {
    const fallback = { ...entriesFromValues(DEFAULT_PREFERENCE_VALUES), ...entriesFromValues(defaults) };
    const device = this.readDevice();
    const values: PreferenceEntries = {};
    const initialized: PreferenceKey[] = [];
    const versions: PreferenceSnapshot["versions"] = {};
    for (const key of GENERAL_KEYS) {
      const shared = this.readShared(key);
      const local = device.overrides[key];
      const group = generalGroup(key);
      values[key] = (!group || device.following[group]) && shared ? shared.value :
        Object.hasOwn(device.overrides, key) ? local : fallback[key];
      if (shared || Object.hasOwn(device.overrides, key)) initialized.push(key);
      if (shared) versions[key] = { updatedAt: shared.updatedAt, deviceId: shared.deviceId };
    }
    const following = { ...device.following, proxy: this.meta.get<unknown>(PROXY_FOLLOWING_KEY) === true };
    return { values: valuesFromEntries(values), following, initialized, versions,
      draftSync: this.meta.get<unknown>("draftSyncEnabled") === true, deviceId: this.deviceId() };
  }

  seed(values: Partial<PreferenceValues>): PreferenceSnapshot {
    const entries = entriesFromValues(values);
    const device = this.readDevice();
    let changed = false;
    for (const key of GENERAL_KEYS) {
      if (!Object.hasOwn(entries, key) || Object.hasOwn(device.overrides, key)) continue;
      const group = generalGroup(key);
      if (group) {
        if (device.following[group] && this.readShared(key)) continue;
        device.overrides[key] = entries[key];
        changed = true;
      } else if (!this.readShared(key)) this.writeShared(key, entries[key], true);
    }
    if (changed) this.meta.put(DEVICE_PREFERENCES_KEY, device);
    return this.snapshot();
  }

  set(key: PreferenceKey, value: unknown): PreferenceSnapshot {
    // proxy 只能经 proxy-set：这里写入会跳过应用、校验和确认，跟随时还会直接上传。
    if (!isPreferenceKey(key) || key === "proxy" || !isPreferenceValue(key, value)) throw new Error("invalid_preference");
    const device = this.readDevice();
    const group = generalGroup(key);
    if (!group || device.following[group]) this.writeShared(key, value);
    else {
      device.overrides[key] = value;
      this.meta.put(DEVICE_PREFERENCES_KEY, device);
    }
    return this.snapshot();
  }

  setFollowing(group: PreferenceGroup, enabled: boolean): PreferenceSnapshot {
    if (group === "proxy") throw new Error("invalid_preference");
    if (!GENERAL_PREFERENCE_GROUPS.includes(group) || typeof enabled !== "boolean") throw new Error("invalid_preference_group");
    const device = this.readDevice();
    if (device.following[group] === enabled) return this.snapshot();
    const effective = entriesFromValues(this.snapshot().values);
    for (const key of GENERAL_KEYS.filter(key => preferenceGroup(key) === group)) {
      if (enabled) {
        if (!this.readShared(key) && Object.hasOwn(effective, key)) this.writeShared(key, effective[key]);
      } else if (Object.hasOwn(effective, key)) device.overrides[key] = effective[key];
      else delete device.overrides[key];
    }
    device.following[group] = enabled;
    this.meta.put(DEVICE_PREFERENCES_KEY, device);
    return this.snapshot();
  }

  private readShared(key: PreferenceKey): VersionedSyncValue | null {
    const value = this.state.get(`${PREFERENCE_STATE_PREFIX}${key}`);
    return isVersionedPreference(key, value) ? value : null;
  }

  private writeShared(key: PreferenceKey, value: unknown, legacySeed = false): void {
    if (key === "proxy") throw new Error("invalid_preference");
    const current = this.readShared(key);
    if (current && current.updatedAt > 0 && sameValue(current.value, value)) return;
    // 旧缓存没有可靠修改时间；迁移值让给已有云值，显式选择才取得正常版本。
    const updatedAt = legacySeed ? 0 : nextSyncTime(this.now(), ...(current ? [current.updatedAt] : []));
    const candidate = { value, updatedAt, deviceId: this.deviceId() };
    if (!isVersionedPreference(key, candidate)) throw new Error("invalid_preference");
    this.state.put(`${PREFERENCE_STATE_PREFIX}${key}`, candidate, candidate.updatedAt);
  }

  private readDevice(): DevicePreferences {
    const raw = this.meta.get<unknown>(DEVICE_PREFERENCES_KEY);
    const candidate = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Partial<DevicePreferences> : {};
    const following = Object.fromEntries(GENERAL_PREFERENCE_GROUPS.map(group =>
      [group, candidate.following?.[group] === true])) as Record<GeneralPreferenceGroup, boolean>;
    const overrides: PreferenceEntries = {};
    if (candidate.overrides && typeof candidate.overrides === "object" && !Array.isArray(candidate.overrides)) {
      for (const [key, value] of Object.entries(candidate.overrides)) {
        if (isPreferenceKey(key) && key !== "proxy" && preferenceGroup(key) && isPreferenceValue(key, value)) overrides[key] = value;
      }
    }
    return { following, overrides };
  }
}

const PLAIN_FIELDS = ["completionNotifications", "layoutMode", "workbenchGuide", "sitePageCloseConfirm", "newSessionConfirm"] as const;
const isPlainField = (field: string): field is typeof PLAIN_FIELDS[number] => (PLAIN_FIELDS as readonly string[]).includes(field);

function entriesFromValues(values: Partial<PreferenceValues>): PreferenceEntries {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("invalid_preference");
  const entries: PreferenceEntries = {};
  for (const [field, value] of Object.entries(values)) {
    if (field === "display") {
      const display = parseDisplayPreferences(value);
      if (!display) throw new Error("invalid_preference");
      entries.density = display.density;
      entries.siteScale = display.siteScale;
    } else if (field === "siteZoom") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_preference");
      for (const [site, zoom] of Object.entries(value)) {
        const key = `siteZoom.${site}`;
        if (!isPreferenceKey(key) || !isPreferenceValue(key, zoom)) throw new Error("invalid_preference");
        entries[key] = zoom;
      }
    } else {
      if (!isPlainField(field) || !isPreferenceValue(field, value)) throw new Error("invalid_preference");
      entries[field] = value;
    }
  }
  return entries;
}

function valuesFromEntries(entries: PreferenceEntries): PreferenceValues {
  const siteZoom: Partial<Record<SiteKey, number>> = {};
  for (const site of SITE_KEYS) {
    const value = entries[`siteZoom.${site}`];
    if (typeof value === "number") siteZoom[site] = value;
  }
  return {
    completionNotifications: entries.completionNotifications as boolean,
    display: { density: entries.density as "compact" | "comfortable", siteScale: entries.siteScale as 0.9 | 1 },
    layoutMode: entries.layoutMode as "overview" | "focus", siteZoom,
    workbenchGuide: structuredClone(entries.workbenchGuide) as PreferenceValues["workbenchGuide"],
    sitePageCloseConfirm: entries.sitePageCloseConfirm as boolean,
    newSessionConfirm: entries.newSessionConfirm as boolean
  };
}
