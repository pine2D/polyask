import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { PersistentDraftClient, type DraftClientApi } from '../src/renderer/draft-client';
import type { DraftInput, StoredDraft } from '../src/shared/drafts';

const input: DraftInput = { kind: 'prompt', context: 'composer', title: '', content: { text: 'labor' } };

function fixture(delayed = false) {
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'local');
  let serial = 0;
  const repository = new DraftRepository(database.state, database.meta, { now: () => 100, createId: () => `draft-${++serial}` });
  const saves: DraftInput[] = [], removals: string[] = [], notices: string[] = [];
  const replies: { finish(): void; fail(): void }[] = [];
  const api: DraftClientApi = {
    listDrafts: async (kind, context) => ({ epoch: repository.epoch(), deviceId: 'local', drafts: repository.list(kind, context) }),
    saveDraft: async (value, epoch) => {
      saves.push(value);
      const saved = repository.save(value, epoch);
      if (!delayed) return saved;
      return new Promise<StoredDraft>((resolve, reject) => replies.push({ finish: () => resolve(saved), fail: () => reject(Error('write_failed')) }));
    },
    removeDraft: async (id, updatedAt, epoch) => { removals.push(id); return repository.remove(id, updatedAt, epoch); }
  };
  const client = new PersistentDraftClient(api, () => notices.push(client.snapshot().status));
  client.edit(input, true, true);
  return { database, repository, client, saves, removals, notices, replies,
    close: () => { client.dispose(); database.close(); } };
}

test('loading local or remote copies only lists recovery choices and never changes form input', async () => {
  const f = fixture();
  try {
    f.repository.save({ ...input, content: { text: 'saved old labor' } });
    await f.client.refresh();
    assert.equal(f.client.snapshot().drafts.length, 1);
    assert.equal(f.saves.length, 0);
    assert.deepEqual(f.client.currentInput()?.content, { text: 'labor' });
  } finally { f.close(); }
});

test('autosave coalesces edits and skips clean initial forms and unsupported legacy APIs', async () => {
  const f = fixture();
  try {
    f.client.edit(input, true, false); await f.client.refresh();
    assert.equal(await f.client.flush(), null);
    f.client.edit(input, true, true);
    f.client.edit({ ...input, content: { text: 'latest labor' } }, true, true);
    const saved = await f.client.flush();
    assert.deepEqual(saved?.content, { text: 'latest labor' });
    assert.equal(f.saves.length, 1);
    assert.equal(await f.client.flush(), saved);
    const legacy = new PersistentDraftClient({}, () => {});
    legacy.edit(input, true, true); await legacy.refresh();
    assert.equal(await legacy.flush(), null);
    legacy.dispose();
  } finally { f.close(); }
});

test('late saves from a previous editor cannot replace a new context or its recovery list', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const old = f.client.flush(); await Promise.resolve();
    assert.equal(f.replies.length, 1);
    f.client.edit({ ...input, context: 'next', content: { text: 'next context' } }, true, true);
    await f.client.refresh();
    f.replies[0].finish(); await old;
    assert.equal(f.client.snapshot().drafts.length, 0);
    assert.deepEqual(f.client.currentInput()?.content, { text: 'next context' });
    const fresh = f.client.flush(); await Promise.resolve();
    f.replies[1].finish(); await fresh;
    assert.equal(f.client.snapshot().drafts[0]?.context, 'next');
  } finally { f.close(); }
});

test('reset invalidates in-flight saves and blocks stale unchanged content until a real edit arrives', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const old = f.client.flush(); await Promise.resolve();
    f.client.invalidate(); f.repository.invalidate(); f.database.resetLocalData();
    await f.client.refresh();
    f.replies[0].finish(); await old;
    assert.equal(f.client.snapshot().drafts.length, 0);
    assert.equal(await f.client.flush(), null);
    assert.equal(f.saves.length, 1);
    f.client.edit({ ...input, content: { text: 'new edit after reset' } }, true, true);
    const fresh = f.client.flush(); await Promise.resolve();
    f.replies[1].finish(); await fresh;
    assert.equal(f.repository.list().length, 1);
  } finally { f.close(); }
});

test('a changed main epoch cancels pending work without saving the pre-reset form', async () => {
  const f = fixture();
  try {
    await f.client.refresh();
    f.repository.invalidate(); f.database.resetLocalData();
    await f.client.refresh();
    assert.equal(await f.client.flush(), null);
    assert.equal(f.saves.length, 0);
  } finally { f.close(); }
});

test('clearSaved waits for an in-flight save and tombstones it without a delayed autosave resurrection', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const pending = f.client.flush(); await Promise.resolve();
    const cleared = f.client.clearSaved();
    f.replies[0].finish(); await pending;
    assert.equal(await cleared, true);
    assert.equal(f.repository.list().length, 0);
    assert.equal(f.repository.get('draft-1')?.deletedAt, 101);
    assert.equal(await f.client.flush(), null);
    assert.equal(f.saves.length, 1);
  } finally { f.close(); }
});

test('an in-flight clear preserves newer edits and never deletes remote branches', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const pending = f.client.flush(); await Promise.resolve();
    const cleared = f.client.clearSaved();
    f.client.edit({ ...input, content: { text: 'new labor' } }, true, true);
    const next = f.client.flush();
    f.replies[0].finish(); await pending;
    assert.equal(await cleared, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    f.replies[1].finish(); await next;
    assert.deepEqual(f.repository.list().map(d => d.content), [{ text: 'new labor' }]);
    const remote: StoredDraft = { ...input, format: 1, id: 'remote', deviceId: 'other', updatedAt: 300 };
    f.database.state.put('draft:remote', remote, 300, false);
    f.client.edit({ ...input, content: { text: 'new labor' } }, true, false);
    await f.client.refresh();
    assert.equal(await f.client.clearSaved(), true);
    assert.deepEqual(f.repository.list().map(d => d.id), ['remote']);
  } finally { f.close(); }
});

test('a failed save retains edits and permits an explicit retry without an unhandled rejection', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const pending = f.client.flush(); await Promise.resolve();
    f.replies[0].fail();
    assert.equal(await pending, null);
    assert.equal(f.client.snapshot().status, 'error');
    assert.deepEqual(f.client.currentInput()?.content, { text: 'labor' });
    const retry = f.client.flush(); await Promise.resolve();
    f.replies[1].finish(); assert.ok(await retry);
    assert.equal(f.client.snapshot().status, 'saved');
  } finally { f.close(); }
});

test('ordinary context changes or leaving before debounce preserve the latest labor but reset does not', async () => {
  const f = fixture();
  try {
    await f.client.refresh();
    f.client.edit({ ...input, content: { text: 'last unsaved edit' } }, true, true);
    f.client.edit({ ...input, context: 'next', content: { text: 'next form' } }, true, true);
    assert.deepEqual(f.repository.list('prompt', 'composer').map(d => d.content), [{ text: 'last unsaved edit' }]);
    await f.client.refresh();
    f.client.dispose();
    assert.deepEqual(f.repository.list('prompt', 'next').map(d => d.content), [{ text: 'next form' }]);
    f.client.activate(); f.client.invalidate(); f.repository.invalidate(); f.database.resetLocalData();
    await f.client.refresh(); f.client.dispose();
    assert.equal(f.repository.list().length, 0);
  } finally { f.close(); }
});

test('clearing the captured sent version cannot erase a newer edit saved during a formal operation', async () => {
  const f = fixture();
  try {
    await f.client.refresh();
    const sent = await f.client.flush(); assert.ok(sent);
    f.client.edit({ ...input, content: { text: 'new unsent labor' } }, true, true);
    await f.client.flush();
    assert.equal(await f.client.clearSaved(sent), false);
    assert.deepEqual(f.repository.list().map(d => d.content), [{ text: 'new unsent labor' }]);
    assert.equal(f.client.snapshot().status, 'saved');
  } finally { f.close(); }
});

test('deleting a reviewed old copy does not suppress newer unsaved edits in the same editor', async () => {
  const f = fixture();
  try {
    await f.client.refresh();
    const old = await f.client.flush(); assert.ok(old);
    f.client.edit({ ...input, content: { text: 'new unfinished labor' } }, true, true);
    assert.equal(await f.client.remove(old), true);
    assert.ok(await f.client.flush());
    assert.deepEqual(f.repository.list().map(d => d.content), [{ text: 'new unfinished labor' }]);
  } finally { f.close(); }
});

test('deleting a loaded matching own copy suppresses re-saving unchanged contents', async () => {
  const f = fixture();
  try {
    const old = f.repository.save(input);
    await f.client.refresh();
    assert.equal(await f.client.remove(old), true);
    assert.equal(await f.client.flush(), null);
    assert.equal(f.repository.list().length, 0);
  } finally { f.close(); }
});

test('actual debounce saves only the latest edit after a quiet period', async () => {
  const f = fixture();
  try {
    await f.client.refresh();
    f.client.edit({ ...input, content: { text: 'first edit' } }, true, true); f.client.schedule();
    await new Promise(resolve => setTimeout(resolve, 100));
    f.client.edit({ ...input, content: { text: 'last edit' } }, true, true); f.client.schedule();
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(f.saves.length, 0);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(f.saves.length, 1);
    assert.deepEqual(f.repository.list().map(d => d.content), [{ text: 'last edit' }]);
  } finally { f.close(); }
});

test('a captured receipt can be cleaned after ordinary unmount without updating the disposed UI', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const pending = f.client.flush(); await Promise.resolve();
    const cleared = f.client.clearSaved(pending);
    f.client.dispose(); const noticeCount = f.notices.length;
    f.replies[0].finish();
    assert.equal((await pending)?.id, 'draft-1');
    assert.equal(await cleared, true);
    assert.equal(f.repository.list().length, 0);
    assert.equal(f.notices.length, noticeCount);
  } finally { f.close(); }
});

test('reset rejects cleanup of a delayed captured receipt even after its editor unmounted', async () => {
  const f = fixture(true);
  try {
    await f.client.refresh();
    const pending = f.client.flush(); await Promise.resolve();
    const cleared = f.client.clearSaved(pending);
    f.client.dispose(); f.repository.invalidate(); f.database.resetLocalData();
    const fresh = f.repository.save({ ...input, content: { text: 'new session labor' } }, f.repository.epoch());
    f.replies[0].finish(); await pending;
    assert.equal(await cleared, false);
    assert.deepEqual(f.repository.get(fresh.id)?.content, { text: 'new session labor' });
  } finally { f.close(); }
});
