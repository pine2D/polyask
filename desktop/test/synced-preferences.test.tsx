import assert from 'node:assert/strict';
import test from 'node:test';
import { act, StrictMode } from 'react';
import type { PolyAskDesktopApi } from '../src/preload/shell';
import type { DisplayPreferences } from '../src/shared/display';
import type { PreferenceKey, PreferenceSnapshot, PreferenceValues } from '../src/shared/preferences';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';

function snapshot(patch: Partial<PreferenceValues> = {}): PreferenceSnapshot {
  return { values: { completionNotifications: false, display: { density: 'compact', siteScale: 0.9 },
    layoutMode: 'overview', siteZoom: {}, workbenchGuide: null, ...patch },
    following: { display: false, layout: false, siteZoom: false }, draftSync: false,
    initialized: (['completionNotifications', 'workbenchGuide'] as PreferenceKey[]).filter(key => Object.hasOwn(patch, key)),
    versions: {}, deviceId: 'fixture' };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, failed) => { resolve = ok; reject = failed; });
  return { promise, resolve, reject };
}
function storageFixture(entries: [string, string][] = []) {
  const values = new Map(entries), writes: string[] = [];
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }, writes };
}
async function fixture(options: {
  storage?: ReturnType<typeof storageFixture>;
  get?: () => Promise<PreferenceSnapshot>;
  seed?: (values: Partial<PreferenceValues>) => Promise<PreferenceSnapshot>;
  set?: (key: string, value: unknown) => Promise<PreferenceSnapshot>;
  strict?: boolean;
  legacyApi?: boolean;
} = {}) {
  const { useSyncedPreferences } = await import('../src/renderer/use-synced-preferences');
  let value!: ReturnType<typeof useSyncedPreferences>, listener!: (state: PreferenceSnapshot) => void;
  const seeds: Partial<PreferenceValues>[] = [], intents: [string, unknown][] = [], displays: DisplayPreferences[] = [];
  let unsubscribed = 0, failures = 0;
  const storage = options.storage ?? storageFixture();
  const api = {
    getPreferences: options.get ?? (async () => snapshot()),
    seedPreferences: async (values: Partial<PreferenceValues>) => { seeds.push(values); return options.seed ? options.seed(values) : snapshot(); },
    setPreference: async (key: string, next: unknown) => { intents.push([key, next]); return options.set ? options.set(key, next) : snapshot({ completionNotifications: next as boolean }); },
    followPreferences: async () => snapshot(), setDraftSync: async () => snapshot(),
    onPreferences: (next: (state: PreferenceSnapshot) => void) => { listener = next; return () => { unsubscribed++; }; }
  };
  setShellApi((options.legacyApi ? { setCompletionNotifications: (enabled: boolean) => { intents.push(['legacy', enabled]); } } : api) as unknown as PolyAskDesktopApi);
  function Fixture() {
    value = useSyncedPreferences({ display: { density: 'compact', siteScale: 0.9 }, storage,
      onDisplay: display => { displays.push(display); }, onPersistenceFailure: () => { failures++; } });
    return <span>{String(value.completionNotifications)}</span>;
  }
  const h = await mountDom(options.strict ? <StrictMode><Fixture /></StrictMode> : <Fixture />);
  return { ...h, value: () => value, seeds, intents, displays, storage, failures: () => failures,
    push: (state: PreferenceSnapshot) => listener(state), unsubscribed: () => unsubscribed,
    close: async () => { await h.close(); setShellApi(null); } };
}

test('legacy display notification and guide are seeded once through authoritative IPC', async () => {
  const guide = { version: 1, disposition: 'dismissed' } as const;
  const h = await fixture({ storage: storageFixture([
    ['polyask.display', JSON.stringify({ density: 'comfortable', siteScale: 1, workbenchGuide: guide })],
    ['polyask.desktop.completion-notifications.v1', 'true']
  ]), seed: async () => snapshot({ completionNotifications: true, display: { density: 'comfortable', siteScale: 1 }, workbenchGuide: guide }) });
  try {
    assert.deepEqual(h.seeds, [{ display: { density: 'comfortable', siteScale: 1 }, completionNotifications: true, workbenchGuide: guide }]);
    assert.equal(h.value().ready, true);
    assert.equal(h.value().completionNotifications, true);
    assert.deepEqual(h.displays.at(-1), { density: 'comfortable', siteScale: 1 });
    assert.deepEqual(h.intents, []);
    assert.equal(h.storage.getItem('polyask.desktop.completion-notifications.v1'), 'true');
  } finally { await h.close(); }
  assert.equal(h.unsubscribed(), 1);
});

test('new device migration does not manufacture shared false notification or empty guide defaults', async () => {
  const h = await fixture();
  try {
    assert.deepEqual(h.seeds, [{ display: { density: 'compact', siteScale: 0.9 } }]);
    assert.deepEqual(h.intents, []);
  } finally { await h.close(); }
});

test('remote push wins over late initial read and seed replies without echoing preference writes', async () => {
  const get = deferred<PreferenceSnapshot>(), seed = deferred<PreferenceSnapshot>();
  const h = await fixture({ get: () => get.promise, seed: () => seed.promise });
  try {
    await act(async () => h.push(snapshot({ completionNotifications: true, display: { density: 'comfortable', siteScale: 1 } })));
    await act(async () => get.resolve(snapshot()));
    await act(async () => h.push(snapshot({ completionNotifications: true, display: { density: 'comfortable', siteScale: 1 }, layoutMode: 'focus' })));
    await act(async () => seed.resolve(snapshot()));
    assert.equal(h.value().completionNotifications, true);
    assert.equal(h.value().snapshot?.values.layoutMode, 'focus');
    assert.deepEqual(h.displays.at(-1), { density: 'comfortable', siteScale: 1 });
    assert.deepEqual(h.intents, []);
    assert.equal(h.storage.getItem('polyask.desktop.completion-notifications.v1'), 'true');
  } finally { await h.close(); }
});

test('new remote state supersedes an in-flight notification save acknowledgement', async () => {
  const set = deferred<PreferenceSnapshot>();
  const h = await fixture({ set: () => set.promise });
  try {
    let save!: Promise<void>;
    await act(async () => { save = h.value().onCompletionNotifications(true); });
    assert.equal(h.value().completionNotifications, false);
    await act(async () => h.push(snapshot({ completionNotifications: false, display: { density: 'comfortable', siteScale: 1 } })));
    await act(async () => { set.resolve(snapshot({ completionNotifications: true })); await save; });
    assert.equal(h.value().completionNotifications, false);
    assert.deepEqual(h.intents, [['completionNotifications', true]]);
    assert.equal(h.storage.getItem('polyask.desktop.completion-notifications.v1'), 'false');
  } finally { await h.close(); }
});

test('a rejected preference save keeps accepted state and reports one persistence failure', async () => {
  const h = await fixture({ set: async () => { throw Error('write_failed'); } });
  try {
    await act(async () => h.value().onCompletionNotifications(true));
    assert.equal(h.value().completionNotifications, false);
    assert.equal(h.failures(), 1);
    assert.deepEqual(h.storage.writes, []);
  } finally { await h.close(); }
});

test('effect replay rejects the superseded initialization before it can seed twice', async () => {
  const first = deferred<PreferenceSnapshot>();
  let reads = 0;
  const h = await fixture({ strict: true, get: () => ++reads === 1 ? first.promise : Promise.resolve(snapshot()) });
  try {
    assert.equal(h.seeds.length, 1);
    await act(async () => first.resolve(snapshot()));
    assert.equal(h.seeds.length, 1);
  } finally { await h.close(); }
});

test('legacy partial shell API stays usable and saves notification preference locally', async () => {
  const h = await fixture({ legacyApi: true });
  try {
    await act(async () => h.value().onCompletionNotifications(true));
    assert.equal(h.value().completionNotifications, true);
    assert.deepEqual(h.storage.writes, ['polyask.desktop.completion-notifications.v1']);
    assert.equal(h.intents.at(-1)?.[0], 'legacy');
    assert.equal(h.failures(), 0);
  } finally { await h.close(); }
});

test('reset accepted state retires legacy shared fields before the next cold-start migration', async () => {
  const storage = storageFixture([
    ['polyask.display', JSON.stringify({ density: 'compact', siteScale: 0.9, workbenchGuide: { version: 1, disposition: 'completed' } })],
    ['polyask.desktop.completion-notifications.v1', 'true']
  ]);
  const h = await fixture({ storage, seed: async () => snapshot({ completionNotifications: true, workbenchGuide: { version: 1, disposition: 'completed' } }) });
  await act(async () => h.push(snapshot()));
  assert.equal(storage.getItem('polyask.desktop.completion-notifications.v1'), null);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem('polyask.display')!), 'workbenchGuide'), false);
  await h.close();
  const cold = await fixture({ storage });
  try { assert.deepEqual(cold.seeds, [{ display: { density: 'compact', siteScale: 0.9 } }]); }
  finally { await cold.close(); }
});

test('reset refresh invalidates a pending initial read before old preferences can seed again', async () => {
  const first = deferred<PreferenceSnapshot>();
  let reads = 0;
  const h = await fixture({ get: () => ++reads === 1 ? first.promise : Promise.resolve(snapshot()),
    storage: storageFixture([['polyask.desktop.completion-notifications.v1', 'true']]) });
  try {
    await act(async () => h.value().refresh());
    await act(async () => first.resolve(snapshot()));
    assert.deepEqual(h.seeds, []);
    assert.equal(h.value().completionNotifications, false);
  } finally { await h.close(); }
});
