import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import type { SitePageClosePreview, SitePageCloseRequest, SitePageCloseResult } from '../src/shared/site-page';
import type { WorkspaceState } from '../src/shared/workspace';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { useSitePageClose } from '../src/renderer/use-site-page-close';
import { mountDom } from './ui/dom-harness';

async function fixture(config: { deferPreview?: boolean; deferClose?: boolean; reason?: SitePageClosePreview['reason']; result?: SitePageCloseResult } = {}) {
  let controller!: ReturnType<typeof useSitePageClose>, busy!: (value: boolean) => void;
  let finishPreview!: (preview: SitePageClosePreview) => void, finishClose!: (result: SitePageCloseResult) => void;
  const closes: SitePageCloseRequest[] = [], workspaces: WorkspaceState[] = [], announcements: string[] = [], surfaces: string[] = [];
  const copy = getCopy('en'), lock = new ExclusiveActionLock();
  const result: SitePageCloseResult = { state: 'closed', workspace: { selectedSites: ['claude'], groups: [], tier: null } };
  function Fixture() {
    const [blocked, setBlocked] = useState(false); busy = setBlocked;
    controller = useSitePageClose({ copy, sites: SITES, busy: blocked, lock,
      api: {
        previewSitePageClose: async site => config.deferPreview ? new Promise<SitePageClosePreview>(resolve => { finishPreview = resolve; })
          : { site, contentsId: 21, reason: config.reason ?? null },
        closeSitePage: async request => { closes.push(request); return config.deferClose ? new Promise<SitePageCloseResult>(resolve => { finishClose = resolve; }) : config.result ?? result; }
      },
      onOpen: () => surfaces.push('confirmation'), onClose: () => surfaces.push('sites'),
      onWorkspace: state => workspaces.push(state), onAnnounce: message => announcements.push(message) });
    return <><button id="opener" onClick={() => { void controller.request('kimi'); }}>Close Kimi</button>{controller.dialog}</>;
  }
  const h = await mountDom(<Fixture />);
  return { ...h, copy, result, lock, closes, workspaces, announcements, surfaces, busy,
    controller: () => controller, finishPreview: (value: SitePageClosePreview) => finishPreview(value),
    finishClose: (value: SitePageCloseResult) => finishClose(value),
    open: async () => { h.document.getElementById('opener')!.focus(); await h.click(h.document.getElementById('opener')!); },
    confirm: () => h.document.querySelector<HTMLButtonElement>('.site-page-close-confirm')!,
    cancel: () => [...h.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === copy.cancel)! };
}

test('a close preview uses a cancel-first modal, states page losses and performs no close without confirmation', async () => {
  const h = await fixture();
  try {
    await h.open();
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    assert.equal(h.document.activeElement === h.cancel(), true);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Unsent drafts.*scroll position.*Login information.*saved answer copies/s);
    assert.deepEqual(h.closes, []);
    await h.click(h.cancel());
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.equal(h.document.activeElement === h.document.getElementById('opener'), true);
    assert.deepEqual(h.workspaces, []);
    assert.deepEqual(h.surfaces, ['confirmation', 'sites']);
  } finally { await h.close(); }
});

test('confirmed close uses the preview identity once and cannot be cancelled while awaiting its result', async () => {
  const h = await fixture({ deferClose: true });
  try {
    await h.open(); await h.click(h.confirm());
    assert.deepEqual(h.closes, [{ site: 'kimi', contentsId: 21, confirmed: true }]);
    assert.equal(h.confirm().disabled, true); assert.equal(h.cancel().disabled, true);
    await h.click(h.confirm()); await h.click(h.cancel());
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    assert.equal(h.closes.length, 1);
    await act(async () => h.finishClose(h.result));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.deepEqual(h.workspaces.map(state => state.selectedSites), [['claude']]);
    assert.deepEqual(h.surfaces, ['confirmation', 'sites']);
  } finally { await h.close(); }
});

test('protected preview and protection gained after preview never apply a false closed workspace', async () => {
  const h = await fixture({ reason: 'generation_pending' });
  try {
    await h.open();
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.deepEqual(h.closes, []); assert.deepEqual(h.workspaces, []);
    assert.equal(h.announcements.at(-1), h.copy.sitePageCloseGeneration);
  } finally { await h.close(); }
  const second = await fixture({ result: { state: 'blocked', reason: 'capture_pending' } });
  try {
    await second.open(); await second.click(second.confirm());
    assert.deepEqual(second.workspaces, []);
    assert.equal(second.announcements.at(-1), second.copy.sitePageCloseCapture);
    assert.equal(second.document.querySelector('[role="dialog"]') === null, true);
  } finally { await second.close(); }
});

test('cancelled preview and reset invalidate late callbacks rather than reopening or replacing new workspace', async () => {
  const h = await fixture({ deferPreview: true });
  try {
    await h.open(); await h.click(h.cancel());
    await act(async () => h.finishPreview({ site: 'kimi', contentsId: 21, reason: null }));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.deepEqual(h.closes, []); assert.deepEqual(h.workspaces, []);
  } finally { await h.close(); }
  const second = await fixture({ deferClose: true });
  try {
    await second.open(); await second.click(second.confirm());
    await act(async () => second.controller().invalidate());
    await act(async () => second.finishClose(second.result));
    assert.deepEqual(second.workspaces, []);
    assert.equal(second.document.querySelector('[role="dialog"]') === null, true);
    assert.deepEqual(second.surfaces, ['confirmation', 'sites']);
  } finally { await second.close(); }
});

test('IME Escape preserves confirmation and the physical action lock prevents close dispatch', async () => {
  const h = await fixture();
  try {
    await h.open();
    const event = new h.window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    await act(async () => h.window.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    let release!: () => void;
    const active = h.lock.run(() => new Promise<void>(resolve => { release = resolve; }));
    await h.click(h.confirm());
    assert.deepEqual(h.closes, []);
    assert.equal(h.announcements.at(-1), h.copy.sitePageCloseBusy);
    release(); await active;
  } finally { await h.close(); }
});

test('busy changes disable confirmation while leaving an unsubmitted preview cancellable', async () => {
  const h = await fixture();
  try {
    await h.open(); await act(async () => h.busy(true));
    assert.equal(h.confirm().disabled, true);
    await h.click(h.confirm()); assert.deepEqual(h.closes, []);
    await h.click(h.cancel());
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
  } finally { await h.close(); }
});
