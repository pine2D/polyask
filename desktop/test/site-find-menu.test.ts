import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import { readSource } from './fixtures';
import { getCopy, formatCopy } from '../src/shared/copy';
import { SITES } from '../src/main/sites';
import { initialSiteFindState, type SiteFindState } from '../src/shared/site-find';
import { registerSiteFindIpc } from '../src/main/site-find-ipc';

function menuHarness() {
  let items: any[] = [], close = () => {};
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readSource('src/main/site-find-menu.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: (name: string) => {
    if (name === 'electron') return { Menu: { buildFromTemplate: (value: any[]) => {
      items = value; return { popup: (options: any) => { close = options.callback; } };
    } } };
    if (name === '../shared/copy') return { formatCopy };
    throw Error('unexpected import: ' + name);
  } });
  const state: SiteFindState = { ...initialSiteFindState(), open: true, session: 1, revision: 3, query: 'needle',
    sites: SITES.map((site, index) => ({ site: site.key, matches: index < 2 ? index + 1 : 0, active: 0,
      status: index === 3 ? 'pending' : index === 4 ? 'unavailable' : 'ready' })) };
  return { state, show: (locale = 'en') => exports.showSiteFindMenu({ isDestroyed: () => false }, state, SITES, getCopy(locale)),
    items: () => items, close: () => close() };
}
test('native find menu uses trusted localized state for nine sites and never binds keys', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const h = menuHarness(), result = h.show(locale), copy = getCopy(locale);
    const sites = h.items().filter(item => item.id?.startsWith('site:'));
    assert.equal(sites.length, 9);
    assert.deepEqual([...sites].map(item => item.enabled), [true, true, false, false, false, false, false, false, false]);
    assert.equal(sites[0].label.includes(SITES[0].label), true);
    assert.equal(sites[3].label.includes(copy.findSearching), true);
    assert.equal(sites[4].label, formatCopy(copy.findUnavailable, { site: SITES[4].label }));
    assert.equal(h.items().some(item => item.label === copy.findLimit && item.enabled === false), true);
    assert.equal(h.items().some(item => item.label === copy.findLimitExclusions && item.enabled === false), true);
    assert.equal(h.items().some(item => item.label === copy.findLimitHint), false, "long tooltip must not stretch the popup");
    assert.equal(h.items().every(item => !item.accelerator), true);
    sites[1].click(); h.close();
    assert.equal(JSON.stringify(await result), JSON.stringify({ kind: 'select', site: SITES[1].key }));
  }
});
test('native find menu cancels or refreshes exactly once and empty queries cannot refresh', async () => {
  const h = menuHarness(); let result = h.show(); h.close(); assert.equal(await result, null);
  result = h.show(); h.items().find(item => item.id === 'refresh').click(); h.close();
  assert.equal(JSON.stringify(await result), '{"kind":"refresh"}');
  const empty = { ...h.state, query: '' }; Object.assign(h.state, empty);
  result = h.show(); assert.equal(h.items().find(item => item.id === 'refresh').enabled, false); h.close(); await result;
});

function ipcHarness() {
  let state = { ...initialSiteFindState(), open: true, session: 1, revision: 2, query: 'first' };
  let resolve!: (action: any) => void, shown = 0;
  const calls: string[] = [], handlers = new Map<string, (event: unknown, value?: unknown) => any>();
  const controller = { get state() { return state; }, close() { state = { ...state, open: false }; return state; },
    select: (site: string) => { calls.push('select:' + site); return state; },
    find: (request: any) => { calls.push('find:' + request.query); return state; } };
  const dispose = registerSiteFindIpc({ handle: (channel, action) => { handlers.set(channel, action); },
    removeHandler: channel => { handlers.delete(channel); } }, controller as any, e => e === 'trusted', new EventEmitter(),
    async () => { shown++; return new Promise<any>(finish => { resolve = finish; }); });
  return { calls, dispose, shown: () => shown, patch: (patch: Partial<SiteFindState>) => { state = { ...state, ...patch }; },
    finish: (action: any) => resolve(action), invoke: (value: unknown = { session: 1, revision: 2 }, sender = 'trusted') =>
      Promise.resolve().then(() => handlers.get('polyask:find-menu')!(sender, value)) };
}
test('find menu IPC validates sender and bounded revision requests before showing anything', async () => {
  const h = ipcHarness();
  try {
    await assert.rejects(h.invoke(undefined, 'foreign'), /untrusted_sender/);
    for (const value of [null, [], {}, { session: 1.5, revision: 2 }, { session: 1, revision: -1 }, { session: 1, revision: Infinity }])
      await assert.rejects(h.invoke(value), /invalid_site_find_request/);
    await h.invoke({ session: 2, revision: 2 }); assert.equal(h.shown(), 0);
    h.patch({ open: false }); await h.invoke(); assert.equal(h.shown(), 0);
  } finally { h.dispose(); }
});
for (const action of [{ kind: 'select', site: 'kimi' }, { kind: 'refresh' }, null]) {
  test(`current native menu action ${action?.kind ?? 'cancel'} runs once`, async () => {
    const h = ipcHarness(); try {
      const pending = h.invoke(); await Promise.resolve(); h.finish(action); await pending;
      assert.deepEqual(h.calls, action?.kind === 'select' ? ['select:kimi'] : action ? ['find:first'] : []);
    } finally { h.dispose(); }
  });
}
for (const mutation of ['query', 'scope', 'revision', 'session', 'close-reopen', 'dispose'] as const) {
  test(`a native menu result after ${mutation} never acts on the new search`, async () => {
    for (const action of [{ kind: 'select', site: 'kimi' }, { kind: 'refresh' }]) {
      const h = ipcHarness(); try {
        const pending = h.invoke(); await Promise.resolve();
        if (mutation === 'dispose') h.dispose();
        else h.patch(mutation === 'query' ? { query: 'next' } : mutation === 'scope' ? { scope: 'current' }
          : mutation === 'revision' ? { revision: 3 } : { open: true, session: 2 });
        h.finish(action); await pending; assert.deepEqual(h.calls, []);
      } finally { h.dispose(); }
    }
  });
}
