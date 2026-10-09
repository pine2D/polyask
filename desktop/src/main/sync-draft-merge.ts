import { DRAFT_SETTING_PREFIX } from '../shared/drafts';
import { compareSyncVersion, type StateFragment, type VersionedSyncValue } from '../shared/sync';
import { draftFromSetting } from './sync-drafts';

/** Generic settings use LWW; a known draft branch is deleted permanently. */
export function terminalDraftSettings(fragments: readonly StateFragment[]): Record<string, VersionedSyncValue> {
  const result: Record<string, VersionedSyncValue> = {};
  for (const fragment of fragments) for (const [key, setting] of Object.entries(fragment.settings)) {
    if (!key.startsWith(DRAFT_SETTING_PREFIX)) continue;
    const next = draftFromSetting(setting);
    if (!next || key !== `${DRAFT_SETTING_PREFIX}${next.id}`) continue;
    const previous = draftFromSetting(result[key]);
    if (previous && previous.kind === next.kind && previous.context === next.context && previous.deviceId === next.deviceId) {
      if (previous.deletedAt !== undefined && next.deletedAt === undefined) continue;
      if (previous.deletedAt === undefined && next.deletedAt !== undefined) { result[key] = setting; continue; }
    }
    if (!previous || compareSyncVersion(next, previous) > 0) result[key] = setting;
  }
  return result;
}
