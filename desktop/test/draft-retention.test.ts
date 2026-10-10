import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { DRAFT_TOMBSTONE_RETENTION_MS } from '../src/main/draft-retention';
import { SyncRepository } from '../src/main/sync-repository';
import type { StateFragment } from '../src/shared/sync';

const DAY = 86_400_000;
const prompt = { kind: 'prompt', context: 'composer', title: '', content: { text: 'unfinished' } } as const;

function device(id: string, start = 1_000) {
  const db = DesktopDatabase.open(':memory:'); db.meta.put('deviceId', id);
  let tick = start, serial = 0;
  const clock = () => tick;
  const drafts = new DraftRepository(db.state, db.meta, { now: clock, createId: () => `${id}-${++serial}` });
  drafts.setSyncEnabled(true);
  return { db, drafts, sync: new SyncRepository(db, clock), at: (value: number) => { tick = value; } };
}
const draftKeys = (fragment: StateFragment) => Object.keys(fragment.settings).filter(key => key.startsWith('polyask.draft.')).sort();

test('a device projects only its own live drafts, but every tombstone it knows', () => {
  const a = device('a'), b = device('b');
  try {
    const own = a.drafts.save(prompt);
    const remote = b.drafts.save({ ...prompt, context: 'other' });
    const removedRemote = b.drafts.save({ ...prompt, context: 'third' });
    a.sync.applyStateFragments({ b: b.sync.localStateFragment() });
    assert.equal(a.drafts.list().length, 3, 'remote branches are still received as recovery candidates');
    assert.equal(a.drafts.remove(removedRemote.id, removedRemote.updatedAt), true);
    assert.deepEqual(draftKeys(a.sync.localStateFragment()), [`polyask.draft.${own.id}`, `polyask.draft.${removedRemote.id}`]);
    assert.equal(a.sync.localStateFragment().settings[`polyask.draft.${remote.id}`], undefined);
  } finally { a.db.close(); b.db.close(); }
});

test('an enabled device stops carrying stale draft copies from its previous cloud fragment', () => {
  const a = device('a');
  try {
    const own = a.drafts.save(prompt);
    const previous: StateFragment = { schema: 1, deviceId: 'a', templates: {}, groups: {}, settings: {
      [`polyask.draft.${own.id}`]: { value: { format: 1, id: own.id, kind: 'prompt', context: 'composer', title: '', content: { text: 'old' } }, updatedAt: 1, deviceId: 'a' },
      'polyask.draft.b-9': { value: { format: 1, id: 'b-9', kind: 'prompt', context: 'x', title: '', content: { text: 'b copy' } }, updatedAt: 1, deviceId: 'b' },
      'polyask.future.setting': { value: 1, updatedAt: 1, deviceId: 'a' }
    } };
    a.db.meta.put('remoteStates', { 'state-a': previous });
    const fragment = a.sync.localStateFragment();
    assert.deepEqual(draftKeys(fragment), [`polyask.draft.${own.id}`]);
    assert.ok(fragment.settings['polyask.future.setting'], 'unknown non-draft settings are still carried for newer builds');
    a.drafts.setSyncEnabled(false);
    assert.deepEqual(draftKeys(a.sync.localStateFragment()).sort(), [`polyask.draft.${own.id}`, 'polyask.draft.b-9'],
      'opting out keeps the existing cloud copy untouched');
  } finally { a.db.close(); }
});

test('expired tombstones are reclaimed only once no known fragment still holds a live copy', () => {
  const a = device('a'), b = device('b');
  try {
    const draft = b.drafts.save(prompt);
    const stale = b.sync.localStateFragment();
    a.sync.applyStateFragments({ b: stale });
    a.drafts.remove(draft.id, draft.updatedAt);
    const later = 1_000 + DRAFT_TOMBSTONE_RETENTION_MS + DAY;
    a.at(later);
    const tombstoneFragment = a.sync.localStateFragment();
    a.sync.applyStateFragments({ b: stale, a: tombstoneFragment });
    assert.equal(a.drafts.get(draft.id)?.deletedAt !== undefined, true, 'b still advertises a live copy: keep the tombstone');

    b.sync.applyStateFragments({ a: tombstoneFragment });
    assert.equal(b.drafts.get(draft.id)?.deletedAt !== undefined, true);
    const acknowledged = b.sync.localStateFragment();
    a.sync.applyStateFragments({ b: acknowledged, a: tombstoneFragment });
    assert.equal(a.db.state.get(`draft:${draft.id}`), null, 'every fragment agrees: the expired tombstone is reclaimed');
    assert.equal(draftKeys(a.sync.localStateFragment()).length, 0);

    // The other copies still carry the old tombstone: it must neither come back nor churn the workspace.
    assert.equal(a.sync.applyStateFragments({ b: acknowledged, a: tombstoneFragment }).changed, false);
    assert.equal(a.db.state.get(`draft:${draft.id}`), null);
    assert.equal(a.drafts.list().length, 0);
  } finally { a.db.close(); b.db.close(); }
});

test('a recent tombstone is kept even when nothing else references it', () => {
  const a = device('a');
  try {
    const draft = a.drafts.save(prompt);
    a.drafts.remove(draft.id, draft.updatedAt);
    a.at(1_000 + DRAFT_TOMBSTONE_RETENTION_MS - DAY);
    a.sync.applyStateFragments({});
    assert.equal(a.drafts.get(draft.id)?.deletedAt !== undefined, true);
    a.at(1_000 + DRAFT_TOMBSTONE_RETENTION_MS + DAY);
    a.drafts.save({ ...prompt, content: { text: 'next question' } });
    assert.equal(a.db.state.get(`draft:${draft.id}`), null, 'starting a new branch also reclaims expired local tombstones');
  } finally { a.db.close(); }
});
