import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const base = resolve(__dirname, '..');
const req = createRequire(`${base}/package.json`);
const { act } = req('react');
const { JSDOM } = req('jsdom');
const { setShellApi } = req(`${base}/src/renderer/shell-api.ts`);
const { SITES } = req(`${base}/src/main/sites.ts`);
const { getCopy } = req(`${base}/src/shared/copy.ts`);
const { createSyncDiagnosticSnapshot } = req(`${base}/src/shared/sync-diagnostics.ts`);

test('production root blocks commands and direct send, tier and collection while prompt drafts cover native views', async () => {
  const copy = getCopy('en');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://polyask.test/' });
  const document = dom.window.document as Document;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.matchMedia = (query: string) => ({ media: query, matches: false, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver',
    'KeyboardEvent', 'Event', 'File', 'FileReader', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true,
      value: key === 'window' ? dom.window : key === 'IS_REACT_ACT_ENVIRONMENT' ? true :
        key === 'fetch' ? () => { throw Error('audit_network_disallowed'); } : dom.window[key] });
  }
  const surfaces: string[] = [];
  let command: (id: string) => void = () => {};
  let newSessions = 0, broadcasts = 0, removedDrafts = 0, tierChanges = 0, collections = 0;
  const status = { state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false,
    oauthConfigured: false, secureTokenStorage: true };
  const runtime = { version: 'audit', distribution: 'installed' };
  const draft = { format: 1, id: 'audit-remote', kind: 'prompt', context: 'composer',
    deviceId: 'remote', updatedAt: 100, title: 'Synthetic draft', content: { text: 'Synthetic saved text' } };
  const api = new Proxy({
    bootstrap: async () => ({ runtime, sites: SITES, statuses: [],
      layout: { mode: 'overview', focused: 'claude', page: 0, pageCount: 1, placements: [] },
      workspace: { selectedSites: ['claude'], groups: [], tier: null },
      promptLibrary: { templates: [], history: [] }, pendingSynthesis: null, sync: status }),
    onCommand: (listener: typeof command) => { command = listener; return () => {}; },
    setSurface: (value: string) => { surfaces.push(value); },
    setDrawerOpen: () => {}, setComposerExpanded: () => {}, setCompletionNotifications: () => {},
    listDrafts: async () => ({ epoch: 0, deviceId: 'local', drafts: [draft] }),
    removeDraft: async () => { removedDrafts++; return true; },
    listFolders: async () => [], searchFolderContents: async () => [],
    queryFolderContents: async () => ({ items: [], total: 0, page: 0, selected: null, selectedPage: null, selectedTargets: [] }),
    listArchiveTags: async () => [], siteHistoryState: async () => ({}),
    syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
    newSession: async () => { newSessions++; return [{ site: 'claude', ok: true }]; },
    broadcast: async () => { broadcasts++; return []; },
    setTier: async () => { tierChanges++; return { selectedSites: ['claude'], groups: [], tier: 'think' }; },
    collect: async () => { collections++; return []; },
    getPreferences: undefined, seedPreferences: undefined, onPreferences: undefined
  }, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    return String(key).startsWith('on') ? () => () => {} : async () => [];
  } });
  setShellApi(api);
  const client = req('react-dom/client');
  const createRoot = client.createRoot;
  let root: any;
  client.createRoot = (...args: unknown[]) => { root = createRoot(...args); return root; };
  const oldCss = req.extensions['.css']; req.extensions['.css'] = () => {};
  const click = async (selector: string) => {
    const target = dom.window.document.querySelector(selector) as HTMLButtonElement | null;
    assert.equal(target === null, false, `missing selector ${selector}`);
    await act(async () => target!.click());
  };
  const emit = async (id: string) => { await act(async () => { command(id); }); };
  const dialogCount = () => dom.window.document.querySelectorAll('[role="dialog"]').length;
  try {
    await act(async () => { req(`${base}/src/renderer/index.tsx`); });
    assert.equal(dom.window.document.querySelector('.app-shell') === null, false);
    await emit('open-settings');
    assert.equal(dom.window.document.querySelector('.settings-workspace') === null, false,
      'baseline: settings is reachable without a draft dialog');
    await emit('open-sites');
    const prompt = dom.window.document.querySelector('textarea[name="prompt"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'Synthetic active question');
      prompt.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(document.querySelector<HTMLButtonElement>('.send')?.disabled, false, 'the baseline prompt is sendable');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-draft-open]')!.click();
      const commandsBefore = surfaces.length;
      command('focus-prompt');
      assert.equal(surfaces.length, commandsBefore, 'draft opening blocks commands before React re-renders');
      prompt.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      document.querySelector<HTMLButtonElement>('.send')!.click();
      document.querySelector<HTMLButtonElement>('.tier-switch button[data-tier-icon=think]')!.click();
    });
    assert.equal(broadcasts, 0, 'send callbacks from the old render cannot dispatch through a new draft cover');
    assert.equal(tierChanges, 0, 'tier callbacks from the old render are blocked synchronously');
    const blockedFrom = surfaces.length;
    const focus = dom.window.document.activeElement;
    for (const id of ['focus-prompt', 'open-settings', 'open-archive', 'new-session', 'set-think',
      'set-fast', 'collect-answers', 'collect-compare', 'open-command-palette']) {
      await emit(id);
      assert.equal(surfaces.length, blockedFrom, `${id} cannot navigate through draft recovery`);
    }
    assert.equal(surfaces.length, blockedFrom, 'root commands cannot change the confirmation surface');
    assert.equal(dialogCount(), 1, 'draft recovery owns the only confirmation');
    assert.equal(dom.window.document.activeElement === focus, true, 'focus remains in draft recovery');
    await click('.send');
    await click('.tier-switch button[data-tier-icon=think]');
    assert.equal(broadcasts, 0); assert.equal(tierChanges, 0); assert.equal(collections, 0);
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(dialogCount(), 0); assert.equal(surfaces.at(-1), 'sites');
    await emit('open-settings');
    assert.equal(surfaces.at(-1), 'settings');
    assert.equal(dom.window.document.querySelector('.settings-workspace') === null, false);
    await emit('open-sites');
    await emit('open-archive');
    assert.equal(surfaces.at(-1), 'archive');
    await emit('open-sites');
    await emit('new-session');
    assert.equal(dialogCount(), 1);
    assert.equal(dom.window.document.querySelector('#confirm-title')?.textContent, copy.newSessionConfirmTitle);
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(dialogCount(), 0); assert.equal(newSessions, 0); assert.equal(removedDrafts, 0);
  } finally {
    await act(async () => root?.unmount());
    setShellApi(null); client.createRoot = createRoot;
    if (oldCss) req.extensions['.css'] = oldCss; else delete req.extensions['.css'];
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
