import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { applyDrafts, projectDrafts } from '../src/main/sync-drafts';
import { DRAFT_SYNC_META_KEY, parseDraftInput, parseStoredDraft } from '../src/shared/drafts';
import type { StateFragment } from '../src/shared/sync';
import { readSource } from './fixtures';

function fixture(deviceId = 'a') {
  const database = DesktopDatabase.open(':memory:');
  database.meta.put('deviceId', deviceId);
  let tick = 100, serial = 0;
  const drafts = new DraftRepository(database.state, database.meta, {
    now: () => tick, createId: () => `${deviceId}-${++serial}`
  });
  return { database, drafts, clock: (value: number) => { tick = value; } };
}

const prompt = { kind: 'prompt', context: 'composer', title: '', content: { text: 'unfinished' } } as const;
function wire(f: ReturnType<typeof fixture>) { return projectDrafts(f.database.state, f.database.meta); }
function settle(f: ReturnType<typeof fixture>) {
  for (const operation of f.database.outbox.ready(0)) f.database.outbox.complete(operation.key, operation.revision);
}

test('saving unfinished and explicitly empty forms keeps one local branch and monotonic versions', () => {
  const f = fixture();
  try {
    const first = f.drafts.save(prompt);
    assert.equal(first.updatedAt, 100);
    f.clock(50);
    const next = f.drafts.save({ ...prompt, content: { text: '' } });
    assert.equal(next.id, first.id);
    assert.equal(next.updatedAt, 101);
    assert.deepEqual(f.drafts.list('prompt', 'composer').map(d => d.content), [{ text: '' }]);
    assert.equal(f.database.outbox.count(), 0);
  } finally { f.database.close(); }
});

test('concurrent device edits to one context retain both drafts without remote replacement', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    a.drafts.setSyncEnabled(true); b.drafts.setSyncEnabled(true);
    const first = a.drafts.save(prompt);
    const other = b.drafts.save({ ...prompt, content: { text: 'device b labor' } });
    const combined = { ...wire(a), ...wire(b) };
    assert.equal(applyDrafts(a.database.state, combined), true);
    assert.equal(applyDrafts(b.database.state, combined), true);
    for (const f of [a, b]) assert.deepEqual(f.drafts.list().map(d => d.id).sort(), ['a-1', 'b-1']);
    const own = a.drafts.save({ ...prompt, content: { text: 'device a edited' } });
    assert.equal(own.id, first.id);
    assert.deepEqual(a.drafts.get(other.id)?.content, { text: 'device b labor' });
    assert.equal(applyDrafts(b.database.state, wire(a)), true);
    assert.deepEqual(b.drafts.get(first.id)?.content, { text: 'device a edited' });
    assert.deepEqual(b.drafts.get(other.id)?.content, { text: 'device b labor' });
  } finally { a.database.close(); b.database.close(); }
});

test('sync is local opt-in and enabling queues drafts and tombstones without deleting cloud records on disable', () => {
  const f = fixture();
  try {
    const first = f.drafts.save(prompt);
    const second = f.drafts.save({ ...prompt, kind: 'decision', context: 'new', content: { title: '' } });
    assert.equal(f.drafts.remove(second.id), true);
    assert.deepEqual(wire(f), {});
    assert.equal(f.database.outbox.count(), 0);
    f.drafts.setSyncEnabled(true);
    assert.equal(f.database.meta.get(DRAFT_SYNC_META_KEY), true);
    assert.deepEqual(f.database.outbox.ready(0).map(op => op.key).sort(), ['state:draft:a-1', 'state:draft:a-2']);
    assert.equal(wire(f)['polyask.draft.a-2'].deletedAt, 101);
    settle(f); f.drafts.setSyncEnabled(false);
    assert.deepEqual(wire(f), {});
    assert.equal(f.database.outbox.count(), 0);
    assert.equal(f.drafts.get(first.id)?.deletedAt, undefined);
    f.drafts.save({ ...prompt, content: { text: 'local only' } });
    assert.equal(f.database.outbox.count(), 0);
  } finally { f.database.close(); }
});

test('deletion strips form labor and stale or newer live copies cannot resurrect a deleted branch', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    a.drafts.setSyncEnabled(true); b.drafts.setSyncEnabled(true);
    const first = a.drafts.save({ ...prompt, title: 'private title' });
    const old = wire(a);
    applyDrafts(b.database.state, old);
    assert.equal(a.drafts.remove(first.id, first.updatedAt), true);
    const removed = a.drafts.get(first.id);
    assert.equal(removed?.deletedAt, 101);
    assert.equal(removed?.title, '');
    assert.equal(removed?.content, null);
    applyDrafts(b.database.state, wire(a));
    applyDrafts(b.database.state, old);
    applyDrafts(b.database.state, { 'polyask.draft.a-1': { ...old['polyask.draft.a-1'], updatedAt: 500 } });
    assert.equal(b.drafts.list().length, 0);
    const fresh = a.drafts.save(prompt);
    assert.equal(fresh.id, 'a-2');
    assert.equal(a.drafts.get(first.id)?.deletedAt, 101);
  } finally { a.database.close(); b.database.close(); }
});

test('a stale removal cannot erase newer edits and removing own branch leaves other devices intact', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    a.drafts.setSyncEnabled(true); b.drafts.setSyncEnabled(true);
    const first = a.drafts.save(prompt), remote = b.drafts.save(prompt);
    applyDrafts(a.database.state, wire(b));
    const next = a.drafts.save({ ...prompt, content: { text: 'new labor' } });
    assert.equal(a.drafts.remove(first.id, first.updatedAt), false);
    assert.equal(a.drafts.removeOwn('prompt', 'composer', first.updatedAt), false);
    assert.equal(a.drafts.removeOwn('prompt', 'composer', next.updatedAt), true);
    assert.deepEqual(a.drafts.list().map(d => d.id), [remote.id]);
    assert.equal(a.drafts.removeOwn('prompt', 'composer'), false);
  } finally { a.database.close(); b.database.close(); }
});

test('reset invalidation rejects old saves and removals while native reset clears drafts and opt-in', () => {
  const f = fixture();
  try {
    const epoch = f.drafts.epoch();
    const first = f.drafts.save(prompt, epoch);
    f.drafts.setSyncEnabled(true);
    f.drafts.invalidate(); f.database.resetLocalData();
    assert.throws(() => f.drafts.save(prompt, epoch), /stale_draft_context/);
    assert.throws(() => f.drafts.remove(first.id, first.updatedAt, epoch), /stale_draft_context/);
    assert.throws(() => f.drafts.removeOwn('prompt', 'composer', undefined, epoch), /stale_draft_context/);
    assert.equal(f.database.state.entries('draft:').length, 0);
    assert.equal(f.database.meta.get(DRAFT_SYNC_META_KEY), null);
    assert.equal(f.database.meta.get('deviceId'), 'a');
    assert.equal(f.database.outbox.count(), 0);
    const fresh = f.drafts.save(prompt, f.drafts.epoch());
    assert.equal(fresh.id, 'a-2');
  } finally { f.database.close(); }
});

test('invalid and non-JSON payloads fail before writes and preserve the last valid draft', () => {
  const f = fixture();
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  const getter = Object.defineProperty({}, 'text', { enumerable: true, get() { throw new Error('getter_executed'); } });
  let deep: unknown = 'leaf'; for (let n = 0; n < 40; n++) deep = [deep];
  const bad = [
    null, [], { ...prompt, kind: 'unknown' }, { ...prompt, title: 'x'.repeat(161) },
    { ...prompt, context: 'x'.repeat(513) }, { ...prompt, sourceUpdatedAt: -1 },
    ...[undefined, NaN, Infinity, 1n, () => {}, new Date(), cycle, polluted, getter, deep,
      { text: 'x'.repeat(524_288) }, { nested: undefined }, Object.assign([], { extra: 'data' })]
      .map(content => ({ ...prompt, content }))
  ];
  try {
    const first = f.drafts.save(prompt);
    for (const input of bad) {
      assert.throws(() => f.drafts.save(input), /invalid_draft/);
      assert.equal(f.drafts.get(first.id)?.updatedAt, 100);
    }
    assert.equal(f.drafts.list().length, 1);
    assert.equal(f.database.outbox.count(), 0);
    assert.equal(parseStoredDraft({ ...first, format: 2 }), null);
    assert.equal(parseStoredDraft({ ...first, deletedAt: undefined }), null);
  } finally { f.database.close(); }
});

test('JSON-safe unfinished values and 100k Unicode prompts are cloned and accepted without business validation', () => {
  const f = fixture();
  try {
    const content = { text: '🙂'.repeat(100_000), fields: ['', null, false, 0], invalidBusinessField: '' };
    const saved = f.drafts.save({ ...prompt, content, sourceUpdatedAt: 12 });
    content.text = 'outside mutation';
    assert.equal((saved.content as { text: string }).text.length, 200_000);
    assert.equal(saved.sourceUpdatedAt, 12);
    (saved.content as { text: string }).text = 'returned mutation';
    assert.equal((f.drafts.get(saved.id)?.content as { text: string }).text.length, 200_000);
    const parsed = parseDraftInput({ ...prompt, title: '  ', context: '', content: [] });
    assert.equal(parsed?.title, '  ');
    assert.equal(parsed?.context, '');
  } finally { f.database.close(); }
});

test('remote ingestion rejects malformed payloads and incompatible identity without mutating valid local records', () => {
  const f = fixture();
  try {
    f.drafts.setSyncEnabled(true);
    const first = f.drafts.save(prompt), original = wire(f)['polyask.draft.a-1'];
    settle(f);
    const wrongValues = [null, { ...first, format: 2 }, { ...first, kind: 'other' },
      { ...first, context: 'x'.repeat(513) }, { ...first, content: { x: undefined } }];
    for (const value of wrongValues) {
      assert.equal(applyDrafts(f.database.state, { 'polyask.draft.a-1': { value, updatedAt: 200, deviceId: 'a' } }), false);
    }
    const payload = original.value as Record<string, unknown>;
    const badVersions = [
      { ...original, updatedAt: -1 }, { ...original, deletedAt: undefined },
      { ...original, deviceId: '' }, { ...original, updatedAt: 200, deviceId: 'foreign' },
      { ...original, updatedAt: 200, value: { ...payload, context: 'different context' } }
    ];
    for (const entry of badVersions) assert.equal(applyDrafts(f.database.state, { 'polyask.draft.a-1': entry }), false);
    assert.equal(applyDrafts(f.database.state, { 'polyask.draft.other-id': original }), false);
    assert.equal(f.drafts.get(first.id)?.updatedAt, 100);
    assert.equal(f.database.outbox.count(), 0);
    assert.equal(applyDrafts(f.database.state, wire(f)), false);
  } finally { f.database.close(); }
});

test('frozen schema 1 draft fixture preserves independent versions, empty labor and deletion through wire round trips', () => {
  const f = fixture('desktop-local');
  const { body } = JSON.parse(readSource('test/fixtures/schema1-state-drafts.json')) as { body: StateFragment };
  try {
    f.drafts.setSyncEnabled(true);
    assert.equal(applyDrafts(f.database.state, JSON.parse(JSON.stringify(body.settings))), true);
    assert.deepEqual(f.drafts.list().map(d => d.id).sort(), ['draft-comparison-a', 'draft-decision-b', 'draft-prompt-a', 'draft-synthesis-b']);
    assert.deepEqual(f.drafts.get('draft-prompt-a')?.content, { text: '' });
    assert.equal(f.drafts.get('draft-gone-a')?.deletedAt, 1756800000050);
    assert.deepEqual(JSON.parse(JSON.stringify(wire(f))), body.settings);
    assert.equal(f.database.outbox.count(), 0);
  } finally { f.database.close(); }
});

test('inherited array or wire prototypes cannot run coercion or smuggle data through validation', () => {
  const f = fixture();
  try {
    const array = Object.setPrototypeOf(['labor'], { toJSON() { return 'coerced'; } });
    assert.throws(() => f.drafts.save({ ...prompt, content: array }), /invalid_draft/);
    f.drafts.setSyncEnabled(true);
    f.drafts.save(prompt);
    const setting = wire(f)['polyask.draft.a-1'];
    const prototypePayload = Object.setPrototypeOf({ ...setting.value as object }, { inherited: true });
    assert.equal(applyDrafts(f.database.state, { 'polyask.draft.a-1': { ...setting, value: prototypePayload, updatedAt: 200 } }), false);
    const prototypeSetting = Object.setPrototypeOf({ ...setting, updatedAt: 201 }, { inherited: true });
    assert.equal(applyDrafts(f.database.state, { 'polyask.draft.a-1': prototypeSetting }), false);
    assert.equal(f.drafts.get('a-1')?.updatedAt, 100);
  } finally { f.database.close(); }
});

test('a matching tombstone wins over any live branch even when its clock is older', () => {
  const f = fixture();
  try {
    const draft = f.drafts.save(prompt);
    f.clock(500); f.drafts.save({ ...prompt, content: { text: 'a concurrent edit' } });
    assert.equal(applyDrafts(f.database.state, { 'polyask.draft.a-1': { updatedAt: 101, deviceId: 'a', deletedAt: 101,
      value: { format: 1, id: draft.id, kind: 'prompt', context: 'composer', title: '', content: null } } }), true);
    assert.equal(f.drafts.get(draft.id)?.deletedAt, 101);
    assert.equal(f.drafts.list().length, 0);
  } finally { f.database.close(); }
});
