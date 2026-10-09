import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/shared/display';
import { loadDisplayPreferences, saveDisplayPreferences } from '../src/renderer/display-preferences';
import { resetLocalSession } from '../src/renderer/local-data-reset';
import { COMPLETION_NOTIFICATIONS_KEY } from '../src/renderer/completion-notification-preference';

function storageFixture(value: unknown, onMutation: () => void = () => undefined) {
  const values = new Map<string, string>([['polyask.display', typeof value === 'string' ? value : JSON.stringify(value)]]);
  const writes: string[] = [];
  let readFailure = false, writeFailure = false;
  return { values, writes,
    getItem: (key: string) => { if (readFailure) throw new Error('read_failed'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { onMutation(); if (writeFailure) throw new Error('write_failed'); writes.push(key); values.set(key, value); },
    removeItem: (key: string) => { onMutation(); values.delete(key); },
    failRead: () => { readFailure = true; }, failWrite: () => { writeFailure = true; } };
}
function withResetWindow(onReset: () => void, action: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const target = new EventTarget();
  target.addEventListener('polyask:drafts-reset', onReset);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try { action(); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
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

test('a successful local reset invalidates drafts before clearing legacy choices and preserves accepted display preferences', () => {
  const order: string[] = [];
  const storage = storageFixture({ density: 'comfortable', siteScale: 1, workbenchGuide: guide }, () => { order.push('storage'); });
  storage.values.set(COMPLETION_NOTIFICATIONS_KEY, 'true');
  let resets = 0, notificationAtReset: string | null = null;
  withResetWindow(() => {
    resets++; order.push('draft-reset'); notificationAtReset = storage.getItem(COMPLETION_NOTIFICATIONS_KEY);
  }, () => resetLocalSession(storage as unknown as Storage, localState()));
  assert.equal(resets, 1);
  assert.equal(order[0], 'draft-reset', 'draft invalidation must precede local storage cleanup');
  assert.equal(notificationAtReset, 'true');
  assert.equal(storage.getItem(COMPLETION_NOTIFICATIONS_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), { density: 'comfortable', siteScale: 1 });
});

test('failure to persist the guide reset reports once while clearing the current local session', () => {
  const order: string[] = [];
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide }, () => { order.push('storage'); });
  storage.values.set(COMPLETION_NOTIFICATIONS_KEY, 'true');
  storage.failWrite();
  let failures = 0, cleared = 0, resets = 0;
  const state = { ...localState(), setText: () => { cleared++; order.push('session'); }, onGuidePreferenceFailed: () => { failures++; } };
  withResetWindow(() => { resets++; order.push('draft-reset'); }, () => resetLocalSession(storage as unknown as Storage, state));
  assert.equal(resets, 1);
  assert.equal(order[0], 'draft-reset');
  assert.equal(storage.getItem(COMPLETION_NOTIFICATIONS_KEY), null);
  assert.equal(cleared, 1);
  assert.equal(failures, 1, 'reset must not promise a durable guide reset when storage rejects it');
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), { ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide });
});

for (const guideWriteFails of [false, true]) test(`failure to remove the notification cache${guideWriteFails ? ' together with a guide write failure' : ''} reports once and does not abort the local session reset`, () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide });
  storage.values.set(COMPLETION_NOTIFICATIONS_KEY, 'true');
  if (guideWriteFails) storage.failWrite();
  storage.removeItem = (key: string) => {
    if (key === COMPLETION_NOTIFICATIONS_KEY) throw new Error('remove_failed');
    storage.values.delete(key);
  };
  let cleared = 0, invalidated = 0, failures = 0, errorMessage: string | null = null;
  const state = { ...localState(), setText: () => { cleared++; },
    guide: { invalidate: () => { invalidated++; } }, onGuidePreferenceFailed: () => { failures++; } };
  try { withResetWindow(() => {}, () => resetLocalSession(storage as unknown as Storage, state)); }
  catch (error) { errorMessage = (error as Error).message; }
  assert.equal(errorMessage, null,
    `notification cache failure must not abort reset (sessionClears=${cleared}, guideInvalidations=${invalidated}, reports=${failures})`);
  assert.equal(cleared, 1);
  assert.equal(invalidated, 1);
  assert.equal(failures, 1);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), guideWriteFails
    ? { ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: guide } : DEFAULT_DISPLAY_PREFERENCES);
});

test('unknown guide versions are discarded rather than preserved as completed', () => {
  const storage = storageFixture({ ...DEFAULT_DISPLAY_PREFERENCES, workbenchGuide: { version: 99, disposition: 'completed' } });
  assert.equal(saveDisplayPreferences(storage, DEFAULT_DISPLAY_PREFERENCES), true);
  assert.deepEqual(JSON.parse(storage.getItem('polyask.display')!), DEFAULT_DISPLAY_PREFERENCES);
});
