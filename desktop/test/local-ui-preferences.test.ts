import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/shared/display';
import { loadDisplayPreferences, saveDisplayPreferences } from '../src/renderer/display-preferences';
import { resetLocalSession } from '../src/renderer/local-data-reset';

function storageFixture(value: unknown) {
  const values = new Map<string, string>([['polyask.display', typeof value === 'string' ? value : JSON.stringify(value)]]);
  const writes: string[] = [];
  let readFailure = false, writeFailure = false;
  return { values, writes,
    getItem: (key: string) => { if (readFailure) throw new Error('read_failed'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (writeFailure) throw new Error('write_failed'); writes.push(key); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    failRead: () => { readFailure = true; }, failWrite: () => { writeFailure = true; } };
}
const guide = { version: 1, disposition: 'dismissed' } as const;
const localState = () => ({ setText: (_text: string) => undefined,
  imageSelection: { clear: () => undefined }, broadcast: { invalidate: () => undefined },
  archiveCapture: { invalidate: () => undefined }, synthesis: { acceptPending: (_value: unknown) => undefined } });

test('display updates preserve the valid guide field while serializing only known local UI fields', () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide, privateUnknown: 'discard' });
  assert.equal(saveDisplayPreferences(storage, { density: 'comfortable', siteScale: 1 }), true);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), {
    density: 'comfortable', siteScale: 1, workbenchGuide: guide
  });
  assert.deepEqual(storage.writes, ['polyask.display'], 'guide state must share the existing local UI key');
});

test('an unreadable existing local UI envelope cannot be blindly overwritten by a display writer', () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide });
  storage.failRead();
  assert.equal(saveDisplayPreferences(storage, { density: 'comfortable', siteScale: 1 }), false);
  assert.deepEqual(storage.writes, []);
});

test('old flat and damaged display JSON retains pointer-appropriate display fallbacks', () => {
  const storage = storageFixture({ density: 'comfortable', siteScale: 1 });
  assert.deepEqual(loadDisplayPreferences(storage, false), { density: 'comfortable', siteScale: 1 });
  storage.values.set('polyask.display', '{broken');
  assert.deepEqual(loadDisplayPreferences(storage, true), { density: 'comfortable', siteScale: 0.9 });
  assert.equal(saveDisplayPreferences(storage, DEFAULT_DISPLAY_PREFERENCES), true);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), DEFAULT_DISPLAY_PREFERENCES);
});

test('a successful local reset removes only the guide field and preserves accepted display preferences', () => {
  const storage = storageFixture({ density: 'comfortable', siteScale: 1, workbenchGuide: guide });
  resetLocalSession(storage as unknown as Storage, localState());
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), { density: 'comfortable', siteScale: 1 });
});

test('failure to persist the guide reset reports once while clearing the current local session', () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide });
  storage.failWrite();
  let failures = 0, cleared = 0;
  const state = { ...localState(), setText: () => { cleared++; }, onGuidePreferenceFailed: () => { failures++; } };
  resetLocalSession(storage as unknown as Storage, state);
  assert.equal(cleared, 1);
  assert.equal(failures, 1, 'reset must not promise a durable guide reset when storage rejects it');
  assert.deepEqual(storage.writes, []);
});

test('unknown guide versions are discarded rather than preserved as completed', () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: { version: 99, disposition: 'completed' } });
  assert.equal(saveDisplayPreferences(storage, DEFAULT_DISPLAY_PREFERENCES), true);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), DEFAULT_DISPLAY_PREFERENCES);
});
