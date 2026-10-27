import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SiteFind } from '../src/renderer/site-find';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { initialSiteFindState, type SiteFindState, type SiteFindRequest } from '../src/shared/site-find';
import { SITES } from '../src/main/sites';
import { mountDom } from './ui/dom-harness';

async function fixture() {
  let listener = (_state: SiteFindState) => {}, revision = 0;
  const requests: SiteFindRequest[] = [], moves: number[] = [], selections: string[] = [];
  let closed = 0, state = initialSiteFindState();
  let delayed = false, release = () => {};
  let delayedMenu = false, releaseMenu = () => {};
  const menus: { session: number; revision: number }[] = [];
  const publish = (patch: Partial<SiteFindState>) => {
    const session = patch.open === true && !state.open ? state.session + 1 : state.session;
    state = { ...state, ...patch, session, revision:++revision }; listener(state); return state;
  };
  setShellApi({
    onSiteFind: (callback: typeof listener) => { listener = callback; return () => { listener = () => {}; }; },
    getSiteFind: async () => state,
    findSites: async (request: SiteFindRequest) => {
      requests.push(request); const result = publish({ ...request });
      if (delayed) { delayed = false; return new Promise(resolve => { release = () => resolve(result); }); }
      return result;
    },
    moveSiteFind: async (direction: -1 | 1) => { moves.push(direction); return state; },
    selectSiteFind: async (site: string) => { selections.push(site); return state; },
    showSiteFindMenu: async (request: { session: number; revision: number }) => { menus.push(request); const snapshot = state;
      if (delayedMenu) { delayedMenu = false; return new Promise(resolve => { releaseMenu = () => resolve(snapshot); }); }
      return snapshot; },
    closeSiteFind: async () => { closed++; return publish({ open:false, sites:[] }); }
  } as any);
  const h = await mountDom(<SiteFind copy={getCopy('en')} sites={SITES} />);
  const emit = async (patch: Partial<SiteFindState>) => { await act(async () => { publish(patch); }); };
  await emit({ open:true, focusRequest:1 });
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 160)); }); };
  return { ...h, emit, settle, requests, moves, selections, menus, closed:() => closed,
    deferMenu:() => { delayedMenu = true; }, releaseMenu:async () => { await act(async () => releaseMenu()); },
    defer:() => { delayed = true; }, release:async () => { await act(async () => release()); },
    stale:async () => { await act(async () => { listener({ ...initialSiteFindState(), open:true, revision:0 }); }); },
    cleanup:async () => { await h.close(); setShellApi(null); } };
}

test('find input focuses and sends bounded queries; repeated opening selects the current text', async () => {
  const h = await fixture();
  try {
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    assert.equal(h.document.activeElement === input, true);
    assert.equal(input.maxLength, 512);
    await h.input(input, '中文 needle'); await h.settle();
    assert.deepEqual(h.requests.at(-1), { query:'中文 needle', scope:'all' });
    await h.emit({ query:'中文 needle', focusRequest:2 });
    assert.equal(input.selectionStart, 0); assert.equal(input.selectionEnd, 9);
    await h.emit({ open:false }); await h.stale();
    assert.equal(h.document.querySelector('[role=search]') === null, true, 'old read response must not reopen search');
  } finally { await h.cleanup(); }
});

test('repeated Ctrl+F preserves edits that have not reached the debounced native query', async () => {
  const h = await fixture();
  try {
    await h.emit({ query:'new', focusRequest:2 });
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    await h.input(input, 'new edited'); await h.emit({ focusRequest:3 });
    assert.equal(input.value, 'new edited');
    assert.equal(input.selectionEnd, 10);
  } finally { await h.cleanup(); }
});

test('a late Enter from a closed query never moves a newly opened search', async () => {
  const h = await fixture();
  try {
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    await h.input(input, 'old needle'); h.defer();
    await act(async () => input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key:'Enter', bubbles:true })));
    await h.emit({ open:false }); await h.emit({ open:true, query:'new needle', focusRequest:3 });
    await h.release();
    assert.deepEqual(h.moves, [], 'old Enter cannot continue after close/reopen');
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!.value, 'new needle');
  } finally { await h.cleanup(); }
});

test('search shows per-site counts, global position and safe navigation controls', async () => {
  const h = await fixture();
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!, 'needle');
    await h.emit({ query:'needle', focusRequest:2, activeSite:'kimi', sites:[
      { site:'claude', matches:2, active:1, status:'ready' },
      { site:'kimi', matches:3, active:2, status:'ready' },
      { site:'gemini', matches:0, active:0, status:'unavailable' }
    ] });
    assert.equal(h.document.querySelector('[data-find-position]')!.textContent, '4 / 5');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-find-site=claude]')!);
    assert.deepEqual(h.selections, ['claude']);
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-find-site=gemini]')!.disabled, true);
    assert.equal(h.document.querySelector('[data-find-site=gemini]')!.getAttribute('aria-label'), 'Gemini: search unavailable');
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    for (const selector of ['[name=site-find-next]','[name=site-find-previous]']) {
      const button = h.document.querySelector<HTMLButtonElement>(selector)!;
      await act(async () => button.focus()); await h.click(button);
      assert.equal(h.document.activeElement === input, true, 'navigation buttons must return focus to the query');
    }
    assert.deepEqual(h.moves, [1, -1]);
  } finally { await h.cleanup(); }
});

test('Enter/Shift+Enter flush input before navigating; IME keys never move or close search', async () => {
  const h = await fixture();
  try {
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    await h.input(input, 'needle');
    const key = async (key: string, extra = {}) => { await act(async () => {
      input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key, bubbles:true, cancelable:true, ...extra }));
    }); };
    await key('Enter', { isComposing:true }); await key('Escape', { keyCode:229 });
    assert.deepEqual(h.moves, []); assert.equal(h.closed(), 0);
    await key('Enter'); await key('Enter', { shiftKey:true });
    assert.deepEqual(h.requests.at(-1), { query:'needle', scope:'all' });
    assert.deepEqual(h.moves, [1, -1]);
    await key('Escape'); assert.equal(h.closed(), 1);
    assert.equal(h.document.querySelector('[role=search]') === null, true);
  } finally { await h.cleanup(); }
});

test('scope selection searches the current page and refresh can retry zero-match results', async () => {
  const h = await fixture();
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!, 'needle');
    const select = h.document.querySelector<HTMLSelectElement>('[name=site-find-scope]')!;
    await act(async () => { select.value = 'current'; select.dispatchEvent(new h.window.Event('change', { bubbles:true })); });
    await h.settle();
    assert.deepEqual(h.requests.at(-1), { query:'needle', scope:'current' });
    await h.emit({ query:'needle', scope:'current', sites:[{site:'claude', matches:0, active:0, status:'ready'}] });
    assert.equal(h.document.querySelector<HTMLButtonElement>('[name=site-find-next]')!.disabled, true);
    const before = h.requests.length;
    await h.click(h.document.querySelector<HTMLButtonElement>('[name=site-find-refresh]')!);
    assert.equal(h.requests.length, before + 1);
    assert.equal(h.document.querySelector('[data-find-position]')!.textContent, 'No matches');
  } finally { await h.cleanup(); }
});


test('compact find exposes a native menu, flushes typed text and restores query focus', async () => {
  const h = await fixture();
  try {
    const bar = h.document.querySelector<HTMLElement>('.site-find')!;
    assert.equal(bar.style.height, '48px');
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    await h.input(input, 'fresh');
    const menu = h.document.querySelector<HTMLButtonElement>('[name=site-find-menu]');
    assert.ok(menu); assert.equal(menu.getAttribute('aria-haspopup'), 'menu');
    await h.click(menu); assert.equal(h.requests.at(-1)?.query, 'fresh');
    assert.equal(h.menus.length, 1); assert.equal(h.menus[0].session, 1);
    assert.equal(h.document.activeElement === input, true);
  } finally { await h.cleanup(); }
});


test('a pending menu neither opens twice nor steals focus after the query changes', async () => {
  const h = await fixture();
  try {
    const input = h.document.querySelector<HTMLInputElement>('[name=site-find-query]')!;
    await h.input(input, 'old'); await h.settle(); h.deferMenu();
    const button = h.document.querySelector<HTMLButtonElement>('[name=site-find-menu]')!;
    await h.click(button); await h.click(button); assert.equal(h.menus.length, 1);
    await h.input(input, 'new');
    const scope = h.document.querySelector<HTMLSelectElement>('[name=site-find-scope]')!;
    await act(async () => scope.focus()); await h.releaseMenu();
    assert.equal(input.value, 'new'); assert.equal(h.document.activeElement === scope, true);
    await h.click(button); assert.equal(h.menus.length, 2);
  } finally { await h.cleanup(); }
});
