import assert from 'node:assert/strict';
import test from 'node:test';
import { useState } from 'react';
import { SITES } from '../src/main/sites';
import type { SiteKey } from '../src/shared/contracts';
import { getCopy } from '../src/shared/copy';
import { WorkspaceSites } from '../src/renderer/workspace-sites';
import { SiteFrames } from '../src/renderer/site-frames';
import { mountDom } from './ui/dom-harness';

async function fixture(busy = false) {
  const opened: readonly SiteKey[] = ['claude', 'kimi'];
  const persistentChanges: SiteKey[][] = [], closes: SiteKey[] = [];
  let desired: readonly SiteKey[] = opened;
  function Fixture() {
    const [participating, setParticipating] = useState(opened);
    desired = participating;
    // Extra props exercise the future participation boundary against the current
    // production component; failures must be behavior assertions, not imports.
    const props = {
      copy: getCopy('en'), sites: SITES, selected: new Set(opened),
      participating: new Set(participating), participationBusy: busy,
      groups: [{ id: 'two', name: 'Different pair', sites: ['kimi', 'gemini'] as SiteKey[], updatedAt: 1, deviceId: 'device' }],
      onSelectionChange: (sites: readonly SiteKey[]) => persistentChanges.push([...sites]),
      onParticipationChange: (sites: readonly SiteKey[]) => setParticipating([...sites]),
      onCloseSitePage: (site: SiteKey) => closes.push(site),
      onSaveGroup: async () => true, onDeleteGroup: () => undefined
    };
    return <WorkspaceSites {...props} />;
  }
  const h = await mountDom(<Fixture />);
  return { ...h, opened, persistentChanges, closes, desired: () => desired };
}

test('skipping an open site changes participation without persisting a page removal', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="scope-sites"][value="kimi"]')!);
    assert.deepEqual(h.persistentChanges, [], 'temporary exclusion must never close or persist page membership');
    assert.deepEqual(h.desired(), ['claude']);
    assert.equal(h.document.querySelector<HTMLInputElement>('input[value="kimi"]')!.checked, false);
    assert.equal(h.document.querySelector('[data-site-key="kimi"]') === null, false);
    await h.click(h.document.querySelector<HTMLInputElement>('input[value="kimi"]')!);
    assert.deepEqual(h.desired(), ['claude', 'kimi']);
    assert.deepEqual(h.persistentChanges, []);
    assert.deepEqual(h.closes, []);
  } finally { await h.close(); }
});

test('clear participation keeps every open page and performs no persistent selection write', async () => {
  const h = await fixture();
  try {
    const clear = [...h.document.querySelectorAll<HTMLButtonElement>('.scope-preset')]
      .find(button => button.textContent === getCopy('en').clearSites)!;
    await h.click(clear);
    assert.deepEqual(h.persistentChanges, [], 'clear is a send-scope action, not close all pages');
    assert.deepEqual(h.desired(), []);
    assert.equal(h.document.querySelector('[data-site-key="claude"]') === null, false);
    assert.equal(h.document.querySelector('[data-site-key="kimi"]') === null, false);
  } finally { await h.close(); }
});

test('applying a saved send group delegates desired membership without closing pages outside it', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-group-id="two"] .group-apply')!);
    assert.deepEqual(h.persistentChanges, [], 'the participation controller opens missing pages without deleting existing ones');
    assert.deepEqual(h.desired(), ['kimi', 'gemini']);
    assert.equal(h.document.querySelector('[data-site-key="claude"]') === null, false);
  } finally { await h.close(); }
});

test('closing a page has a separate explicit action and never toggles participation itself', async () => {
  const h = await fixture();
  try {
    const close = h.document.querySelector<HTMLButtonElement>('[data-site-key="kimi"] [data-close-site="kimi"]');
    assert.equal(close === null, false, 'open pages need a distinct close action');
    await h.click(close!);
    assert.deepEqual(h.closes, ['kimi']);
    assert.deepEqual(h.desired(), ['claude', 'kimi']);
    assert.deepEqual(h.persistentChanges, []);
    assert.equal(h.document.querySelector('[data-site-key="gemini"] [data-close-site]') === null, true);
  } finally { await h.close(); }
});

test('dispatch freezes participation edits rather than mutating the frozen request', async () => {
  const h = await fixture(true);
  try {
    const checkbox = h.document.querySelector<HTMLInputElement>('input[value="kimi"]')!;
    assert.equal(checkbox.disabled, true);
    await h.click(checkbox);
    for (const button of h.document.querySelectorAll<HTMLButtonElement>('.scope-preset,.group-apply')) {
      assert.equal(button.disabled, true);
      await h.click(button);
    }
    assert.deepEqual(h.desired(), ['claude', 'kimi']);
    assert.deepEqual(h.persistentChanges, []);
  } finally { await h.close(); }
});

test('site headers reflect participation without removing an excluded open tile', async () => {
  const props = {
    copy: getCopy('en'), sites: SITES, selected: new Set<SiteKey>(['claude', 'kimi']),
    participating: new Set<SiteKey>(['claude']), participationBusy: true,
    statuses: {}, history: {}, onToggle: () => undefined, onFocus: () => undefined,
    onReload: () => undefined, onBack: () => undefined,
    layout: { mode: 'overview' as const, focused: 'claude' as const, page: 0, pageCount: 1,
      placements: ['claude', 'kimi'].map(key => ({ key: key as SiteKey, bounds: { x: 0, y: 0, width: 400, height: 300 } })) }
  };
  const h = await mountDom(<SiteFrames {...props} />);
  try {
    const checkbox = h.document.querySelector<HTMLInputElement>('input[name="sites"][value="kimi"]')!;
    assert.equal(checkbox.checked, false, 'a retained page must not pretend to participate');
    assert.equal(checkbox.disabled, true, 'dispatch freezes both checklist and tile-header participation');
    assert.equal(h.document.querySelectorAll('.tile-frame').length, 2);
  } finally { await h.close(); }
});
