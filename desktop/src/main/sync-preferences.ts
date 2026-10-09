import {
  isPreferenceKey, isVersionedPreference, PREFERENCE_SETTING_PREFIX, PREFERENCE_STATE_PREFIX
} from "../shared/preferences";
import { compareSyncVersion, type VersionedSyncValue } from "../shared/sync";
import type { StateRepository } from "./state-repository";

export function projectPreferences(state: StateRepository): Record<string, VersionedSyncValue> {
  const settings: Record<string, VersionedSyncValue> = {};
  for (const { key: stateKey, value } of state.entries<unknown>(PREFERENCE_STATE_PREFIX)) {
    const key = stateKey.slice(PREFERENCE_STATE_PREFIX.length);
    if (isPreferenceKey(key) && isVersionedPreference(key, value)) {
      settings[`${PREFERENCE_SETTING_PREFIX}${key}`] = value;
    }
  }
  return settings;
}

export function applyPreferences(state: StateRepository, settings: Readonly<Record<string, VersionedSyncValue>>): boolean {
  let changed = false;
  for (const [setting, value] of Object.entries(settings)) {
    if (!setting.startsWith(PREFERENCE_SETTING_PREFIX)) continue;
    const key = setting.slice(PREFERENCE_SETTING_PREFIX.length);
    if (!isPreferenceKey(key) || !isVersionedPreference(key, value)) continue;
    const stateKey = `${PREFERENCE_STATE_PREFIX}${key}`;
    const current = state.get(stateKey);
    if (isVersionedPreference(key, current) && compareSyncVersion(value, current) <= 0) continue;
    state.put(stateKey, value, value.updatedAt, false);
    changed = true;
  }
  return changed;
}
