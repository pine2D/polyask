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
const { initialSiteFindState } = req(`${base}/src/shared/site-find.ts`);
const { createSyncDiagnosticSnapshot } = req(`${base}/src/shared/sync-diagnostics.ts`);

test('production root gates toolbar and commands on unfinished actions and site participation', async (t) => {
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
  let publishWorkspace: (state: object) => void = () => {};
  let publishStatus: (state: object) => void = () => {};
  const capturedSites: string[][] = [];
  const capturedRuns: (string | null)[] = [];
  const archiveSizes: number[] = [];
  const archivePrompts: string[] = [];
  let sentRun = '';
  let siteFocus = 0;
  let newSessions = 0, broadcasts = 0, removedDrafts = 0, tierChanges = 0, collections = 0;
  const status = { state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false,
    oauthConfigured: false, secureTokenStorage: true };
  const runtime = { version: 'audit', distribution: 'installed' };
  const draft = { format: 1, id: 'audit-remote', kind: 'prompt', context: 'composer',
    deviceId: 'remote', updatedAt: 100, title: 'Synthetic draft', content: { text: 'Synthetic saved text' } };
  let finishTier: (() => void) | undefined;
  const api = new Proxy({
    bootstrap: async () => ({ runtime, sites: SITES, statuses: [],
      layout: { mode: 'overview', focused: 'claude', page: 0, pageCount: 1, placements: [] },
      workspace: { selectedSites: ['claude'], groups: [], tier: null },
      promptLibrary: { templates: [], history: [] }, pendingSynthesis: null, sync: status }),
    onCommand: (listener: typeof command) => { command = listener; return () => {}; },
    onWorkspaceState: (listener: typeof publishWorkspace) => { publishWorkspace = listener; return () => {}; },
    onStatus: (listener: typeof publishStatus) => { publishStatus = listener; return () => {}; },
    listQuestions: async () => ({ items: [], cursor: null }),
    getSiteFind: async () => initialSiteFindState(), closeSiteFind: async () => initialSiteFindState(),
    setSurface: (value: string) => { surfaces.push(value); },
    focusCurrentSite: () => { siteFocus++; }, setDrawerOpen: () => {}, setComposerExpanded: () => {}, setCompletionNotifications: () => {},
    listDrafts: async () => ({ epoch: 0, deviceId: 'local', drafts: [draft] }),
    removeDraft: async () => { removedDrafts++; return true; },
    listFolders: async () => [], searchFolderContents: async () => [],
    queryFolderContents: async () => ({ items: [], total: 0, page: 0, selected: null, selectedPage: null, selectedTargets: [] }),
    listArchiveTags: async () => [], getArchive: async () => null, siteHistoryState: async () => ({}),
    syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
    newSession: async () => { newSessions++; return [{ site: 'claude', ok: true }]; },
    broadcast: async (request: { runId: string; sites: string[] }) => {
      broadcasts++; sentRun = request.runId; return request.sites.map(site => ({ site, ok: true }));
    },
    applyTier: async (tier: string | null) => {
      tierChanges++;
      await new Promise<void>(resolve => { finishTier = resolve; });
      return { workspace: { selectedSites: ['claude'], groups: [], tier },
        results: tier ? [{ site: 'claude', ok: true, selection: { requested: tier, outcome: 'mode_only', observed: tier } }] : [] };
    },
    collectAnswers: async ({ sites, runId }: { sites: string[]; runId: string | null }) => {
      collections++; capturedSites.push(sites); capturedRuns.push(runId);
      return sites.map(site => ({ host: site, label: site, text: 'Synthetic answer' }));
    },
    addArchive: async (entry: { results: unknown[]; text: string }) => {
      archiveSizes.push(entry.results.length); archivePrompts.push(entry.text); return { ...entry, id: 'synthetic-archive' };
    },
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
    for (const id of ['edit-prompt', 'focus-prompt']) {
      await emit('open-question-history');
      assert.equal(document.querySelector('.question-search input') === null, false);
      await emit(id);
      assert.equal(document.querySelector('[data-composer-toggle]')?.getAttribute('aria-expanded'), String(id === 'edit-prompt'));
      if (id === 'edit-prompt') assert.equal(document.activeElement === document.querySelector('[name=prompt]'), true, 'global activation owns prompt focus');
      else assert.equal(siteFocus, 1, 'Alt+Q closes the expanded prompt even with history open');
    }

    await emit('open-question-history');
    await click('.question-history .panel-close');
    assert.equal(document.activeElement === document.querySelector('.question-trigger'), true, 'ordinary close returns to the history trigger');
    await emit('open-settings');
    assert.equal(dom.window.document.querySelector('.settings-workspace') === null, false,
      'baseline: settings is reachable without a draft dialog');
    await emit('open-sites');
    let prompt = dom.window.document.querySelector('textarea[name="prompt"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'Synthetic active question');
      prompt.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(document.querySelector<HTMLButtonElement>('.send')?.disabled, false, 'the baseline prompt is sendable');
    await click('.tier-switch button[data-tier-icon=think]');
    assert.equal(tierChanges, 1, 'toolbar dispatches immediate tier intent before any send');
    assert.equal(document.querySelector<HTMLButtonElement>('.send')?.disabled, true);
    await emit('set-fast'); await emit('new-session');
    await click('.send');
    assert.equal(tierChanges, 1, 'mode shortcuts share the in-flight lock');
    assert.equal(newSessions, 0); assert.equal(broadcasts, 0);
    await emit('open-settings');
    await emit('collect-answers'); await emit('collect-compare');
    assert.equal(surfaces.at(-1), 'settings', 'busy collection commands also leave navigation alone');
    assert.equal(collections, 0);
    await emit('open-sites');
    prompt = document.querySelector<HTMLTextAreaElement>('textarea[name=prompt]')!;
    await act(async () => { finishTier!(); });
    assert.equal(document.querySelector<HTMLButtonElement>('.send')?.disabled, false);
    assert.equal(document.querySelector('[data-tier-icon=think]')?.getAttribute('aria-pressed'), 'true');
    assert.equal(prompt.value, 'Synthetic active question');
    tierChanges = 0;
    await emit('open-task-setup');
    assert.equal(document.querySelector('.task-setup') === null, false, 'production command opens task preparation');
    assert.equal(surfaces.at(-1), 'confirmation', 'task preparation covers native views');
    await emit('set-fast'); await emit('new-session'); await click('.send');
    assert.equal(tierChanges, 0); assert.equal(newSessions, 0); assert.equal(broadcasts, 0);
    await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('.task-setup') === null, true);
    assert.equal(prompt.value, 'Synthetic active question', 'cancelling task preparation preserves the composer');
    assert.equal(surfaces.at(-1), 'sites');
    const expanded = () => document.querySelector('[data-composer-toggle]')?.getAttribute('aria-expanded');
    await emit('focus-prompt');
    assert.equal(expanded(), 'true'); assert.equal(document.activeElement === prompt, true);
    await emit('focus-prompt');
    assert.equal(expanded(), 'false'); assert.equal(siteFocus, 2);
    assert.equal(prompt.value, 'Synthetic active question');
    await emit('edit-prompt'); await emit('edit-prompt');
    assert.equal(expanded(), 'true', 'global activation always opens the input');
    await emit('focus-current-site');
    assert.equal(siteFocus, 3); assert.equal(prompt.value, 'Synthetic active question');

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
    for (const id of ['focus-prompt', 'edit-prompt', 'focus-current-site', 'open-settings', 'open-archive', 'new-session', 'set-think',
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
    const archiveStage = dom.window.document.querySelector('.surface-stage');
    assert.equal(archiveStage !== null, true);
    await emit('open-settings');
    assert.equal(surfaces.at(-1), 'settings');
    assert.equal(dom.window.document.querySelector('.surface-stage') === archiveStage, true,
      'direct archive -> settings switch reuses the .surface-stage container');
    await emit('open-sites');
    await emit('new-session');
    assert.equal(dialogCount(), 1);
    assert.equal(dom.window.document.querySelector('#confirm-title')?.textContent, copy.newSessionConfirmTitle);
    await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(dialogCount(), 0); assert.equal(newSessions, 0); assert.equal(removedDrafts, 0);
    await t.test('comparison requires two completed participants through both entry points', async () => {
      const opened = ['claude', 'kimi'];
      const scope = async (selectedSites: string[], participatingSites: string[]) => {
        await act(async () => publishWorkspace({ selectedSites, participatingSites, groups: [], tier: null }));
      };
      const disabled = () => document.querySelector('.compare-trigger')?.getAttribute('aria-disabled');
      await act(async () => {
        for (const site of opened) publishStatus({ site, phase: 'complete' });
      });
      for (const pages of [['claude'], opened]) {
        await scope(pages, ['claude']);
        await emit('collect-compare');
        assert.deepEqual(capturedSites, [], 'the command must ignore a single completed participant');
        assert.equal(disabled(), 'true');
        await click('.compare-trigger');
        assert.deepEqual(capturedSites, [], 'the toolbar must ignore a single completed participant');
      }
      await emit('collect-answers');
      assert.deepEqual(capturedSites, [['claude']], 'manual collection still accepts a single participant');
      await scope(opened, opened);
      await act(async () => publishStatus({ site: 'kimi', phase: 'generating' }));
      assert.equal(disabled(), 'true');
      await emit('collect-compare');
      assert.equal(capturedSites.length, 1);
      await act(async () => publishStatus({ site: 'kimi', phase: 'complete' }));
      assert.equal(disabled(), 'false');
      await emit('collect-compare');
      await emit('open-sites');
      await click('.compare-trigger');
      assert.deepEqual(capturedSites, [['claude'], opened, opened]);
      assert.deepEqual(archiveSizes, [1, 2, 2]);

      await emit('open-sites');
      await click('.send');
      assert.ok(sentRun);
      const composer = document.querySelector<HTMLTextAreaElement>('textarea[name=prompt]')!;
      assert.equal(composer.value, '', 'a successful broadcast cleared its draft');
      const three = [...opened, 'chatgpt'];
      await scope(three, three);
      await act(async () => {
        for (const site of opened) publishStatus({ site, phase: 'complete', generation: { runId: sentRun, state: 'complete' } });
      });
      for (const phase of ['ready', 'failed', 'complete']) {
        await act(async () => publishStatus({ site: 'chatgpt', phase,
          ...(phase === 'complete' ? { generation: { runId: 'previous-question', state: 'complete' } } : {}) }));
        assert.equal(disabled(), 'false', 'two completed participants are enough');
        const previous: number = capturedSites.length;
        if (phase === 'failed') await act(async () => {
          const next = document.querySelector<HTMLTextAreaElement>('textarea[name=prompt]')!;
          Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(next, 'Next draft');
          next.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        if (phase === 'ready') await emit('collect-compare'); else await click('.compare-trigger');
        assert.equal(capturedSites.length, previous + 1, 'new or failed participants cannot discard the last run');
        assert.deepEqual(capturedSites.at(-1), opened);
        assert.equal(capturedRuns.at(-1), sentRun);
        assert.equal(archivePrompts.at(-1), 'Synthetic active question');
        await emit('open-sites');
      }
    });
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
