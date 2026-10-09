import { PARTICIPATION_SETTING, parseStoredParticipation, type StoredParticipation } from '../shared/workspace-participation';
import { mergeStateFragments, type StateFragment, type VersionedSyncValue } from '../shared/sync';
import { SITES } from './sites';

export function participationFromSetting(setting?: VersionedSyncValue): StoredParticipation | null {
  if (!setting || 'deletedAt' in setting || !setting.value || typeof setting.value !== 'object' || Array.isArray(setting.value)) return null;
  const entries = Object.entries(setting.value);
  if (entries.some(([, flag]) => typeof flag !== 'boolean')) return null;
  return parseStoredParticipation({ sites: entries.flatMap(([host, flag]) =>
    flag ? SITES.find(site => site.host === host)?.key ?? [] : []), updatedAt: setting.updatedAt, deviceId: setting.deviceId });
}

export function projectParticipation(value: unknown, remote: Readonly<Record<string, StateFragment>>): Record<string, VersionedSyncValue> {
  const participation = parseStoredParticipation(value);
  if (!participation) return {};
  const setting = mergeStateFragments(Object.values(remote)).settings[PARTICIPATION_SETTING];
  const stored = setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value) ? setting.value : {};
  const unknown = Object.fromEntries(Object.entries(stored).filter(([host, flag]) =>
    !SITES.some(site => site.host === host) && typeof flag === 'boolean'));
  const known = Object.fromEntries(participation.sites.map(key => [SITES.find(site => site.key === key)!.host, true]));
  return { [PARTICIPATION_SETTING]: { value: { ...unknown, ...known },
    updatedAt: participation.updatedAt, deviceId: participation.deviceId } };
}
