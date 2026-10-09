import { DRAFT_SETTING_PREFIX, DRAFT_STATE_PREFIX, DRAFT_SYNC_META_KEY, parseStoredDraft } from '../shared/drafts';
import { compareSyncVersion, type VersionedSyncValue } from '../shared/sync';
import type { MetaRepository } from './meta-repository';
import type { StateRepository } from './state-repository';

export function projectDrafts(state: StateRepository, meta: MetaRepository): Record<string, VersionedSyncValue> {
  if (meta.get(DRAFT_SYNC_META_KEY) !== true) return {};
  return Object.fromEntries(state.entries(DRAFT_STATE_PREFIX).flatMap(({ key, value }) => {
    const draft = parseStoredDraft(value);
    if (!draft || key !== `${DRAFT_STATE_PREFIX}${draft.id}`) return [];
    const { updatedAt, deviceId, deletedAt, ...payload } = draft;
    return [[`${DRAFT_SETTING_PREFIX}${draft.id}`, { value: payload, updatedAt, deviceId,
      ...(deletedAt === undefined ? {} : { deletedAt }) }]];
  }));
}

export function applyDrafts(state: StateRepository, settings: Readonly<Record<string, VersionedSyncValue>>): boolean {
  let changed = false;
  for (const [key, setting] of Object.entries(settings)) {
    if (!key.startsWith(DRAFT_SETTING_PREFIX)) continue;
    const draft = draftFromSetting(setting);
    if (!draft || key !== `${DRAFT_SETTING_PREFIX}${draft.id}`) continue;
    const stateKey = `${DRAFT_STATE_PREFIX}${draft.id}`;
    const current = parseStoredDraft(state.get(stateKey));
    const sameState = current && Object.hasOwn(current, 'deletedAt') === Object.hasOwn(draft, 'deletedAt');
    if (current && (current.deviceId !== draft.deviceId || current.kind !== draft.kind || current.context !== draft.context ||
      (Object.hasOwn(current, 'deletedAt') && !Object.hasOwn(draft, 'deletedAt')) ||
      (sameState && compareSyncVersion(draft, current) <= 0))) continue;
    state.put(stateKey, draft, draft.updatedAt, false);
    changed = true;
  }
  return changed;
}

export function draftFromSetting(setting: unknown) {
  try {
    if (!plain(setting)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(setting);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
      !['value', 'updatedAt', 'deviceId', 'deletedAt'].includes(key) || !('value' in descriptors[key]))) return null;
    const item = setting;
    const payload = item.value;
    if (!plain(payload)) return null;
    const fields = Object.getOwnPropertyDescriptors(payload);
    if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' ||
      !['format', 'id', 'kind', 'context', 'title', 'content', 'sourceUpdatedAt'].includes(key) || !('value' in fields[key]))) return null;
    return parseStoredDraft({ ...payload, updatedAt: item.updatedAt, deviceId: item.deviceId,
      ...(Object.hasOwn(item, 'deletedAt') ? { deletedAt: item.deletedAt } : {}) });
  } catch { return null; }
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
