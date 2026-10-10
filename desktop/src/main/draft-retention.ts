import { DRAFT_SETTING_PREFIX, DRAFT_STATE_PREFIX, parseStoredDraft, type StoredDraft } from '../shared/drafts';
import type { StateFragment } from '../shared/sync';
import type { StateRepository } from './state-repository';

/**
 * Draft tombstones are reclaimed after this long. A deletion must first reach every device that
 * could still advertise the live branch; see docs/desktop.md (drafts) for the full rule.
 */
export const DRAFT_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function expiredDraftTombstone(draft: StoredDraft, now: number): boolean {
  return draft.deletedAt !== undefined && now - draft.deletedAt > DRAFT_TOMBSTONE_RETENTION_MS;
}

/** Draft ids some known fragment still carries in any form other than a tombstone (malformed counts as live). */
function advertisedLive(remoteStates: Readonly<Record<string, StateFragment>>): Set<string> {
  const live = new Set<string>();
  for (const fragment of Object.values(remoteStates)) {
    for (const [key, setting] of Object.entries(fragment?.settings ?? {})) {
      if (!key.startsWith(DRAFT_SETTING_PREFIX)) continue;
      if (!setting || typeof setting !== 'object' || !Object.hasOwn(setting, 'deletedAt')) live.add(key.slice(DRAFT_SETTING_PREFIX.length));
    }
  }
  return live;
}

/**
 * Physically drops expired draft tombstones that no known fragment contradicts. This is the only
 * physical draft deletion besides a local reset; it never enqueues an upload (the next state
 * upload simply omits the key, and stale cloud copies of the tombstone are ignored on import).
 */
export function purgeDraftTombstones(state: StateRepository, remoteStates: Readonly<Record<string, StateFragment>>, now: number): number {
  const live = advertisedLive(remoteStates);
  let purged = 0;
  for (const { key, value } of state.entries(DRAFT_STATE_PREFIX)) {
    const draft = parseStoredDraft(value);
    if (!draft || key !== `${DRAFT_STATE_PREFIX}${draft.id}` || !expiredDraftTombstone(draft, now) || live.has(draft.id)) continue;
    if (state.dropTombstone(key)) purged++;
  }
  return purged;
}
