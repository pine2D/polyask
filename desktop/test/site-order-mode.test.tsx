import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { SITES } from '../src/main/sites';
import type { SiteKey } from '../src/shared/contracts';
import { getCopy } from '../src/shared/copy';
import { WorkspaceSites } from '../src/renderer/workspace-sites';
import { useSiteParticipation } from '../src/renderer/use-site-participation';
import { mountDom } from './ui/dom-harness';

async function fixture(opened: readonly SiteKey[] = SITES.map(site => site.key)) {
  const changes: SiteKey[][] = [];
  let publish!: (sites: readonly SiteKey[]) => void;
  function Fixture() {
    const [keys, setKeys] = useState(opened);
    publish = setKeys;
    return <WorkspaceSites copy={getCopy('en')} sites={SITES} selected={new Set(keys)} participating={new Set(keys)} groups={[]}
      onParticipationChange={() => undefined} onSelectionChange={next => { changes.push([...next]); setKeys(next); }}
      onSaveGroup={async () => true} onDeleteGroup={() => undefined} />;
  }
  const h = await mountDom(<Fixture />);
  return { ...h, changes, publish, toggle: () => h.document.querySelector<HTMLButtonElement>('[data-sites-mode-toggle]') };
}

test('default selection mode has no sorting controls or sorting hint in its tab sequence', async () => {
  const h = await fixture();
  try {
    assert.equal(h.document.querySelectorAll('.site-drag-handle').length, 0, 'selection must not compete with nine sorting handles');
    assert.equal(h.document.querySelectorAll('.site-move-actions button').length, 0);
    assert.equal(h.document.querySelector('.site-order-hint') === null, true);
    assert.equal(h.document.querySelectorAll('input[name="scope-sites"]').length, 9);
  } finally { await h.close(); }
});

test('explicit sorting mode persists each move and finishing only hides sorting controls', async () => {
  const h = await fixture(['claude', 'kimi']);
  try {
    assert.equal(h.toggle() === null, false, 'sorting needs an explicit mode action');
    await h.click(h.toggle()!);
    assert.equal(h.toggle()!.getAttribute('aria-pressed'), 'true');
    assert.equal(h.document.querySelectorAll('.site-drag-handle').length, 2);
    assert.equal(h.document.querySelectorAll('input[name="scope-sites"]').length, 0);
    const handle = h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle')!;
    handle.focus();
    await act(async () => handle.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    assert.deepEqual(h.changes, [['kimi', 'claude']]);
    assert.equal(h.document.activeElement === handle, true);
    await h.click(h.toggle()!);
    assert.equal(h.document.querySelectorAll('.site-drag-handle').length, 0);
    assert.equal(h.document.activeElement === h.toggle(), true);
    assert.equal(h.changes.length, 1, 'Done exits the mode and must not save a second time');
  } finally { await h.close(); }
});

test('the order action is unavailable when there are no open pages', async () => {
  const h = await fixture([]);
  try {
    assert.equal(h.toggle() === null, false);
    assert.equal(h.toggle()!.disabled, true);
    assert.deepEqual(h.changes, []);
  } finally { await h.close(); }
});

test('external removal of the focused ordered page keeps keyboard focus on a remaining handle', async () => {
  const h = await fixture(['claude', 'kimi']);
  try {
    await h.click(h.toggle()!);
    const initial = h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle')!;
    initial.focus();
    await act(async () => h.publish(['kimi']));
    const remaining = h.document.querySelector<HTMLButtonElement>('[data-site-key="kimi"] .site-drag-handle')!;
    assert.equal(h.document.activeElement === remaining, true, 'removing a focused page must not leave focus on the document body');
    assert.deepEqual(h.changes, [], 'remote close must not produce a new reorder or reopen the removed page');
  } finally { await h.close(); }
});

test('remote page removal does not steal focus that has already moved outside its ordering controls', async () => {
  const h = await fixture(['claude', 'kimi']);
  try {
    await h.click(h.toggle()!);
    h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle')!.focus();
    h.toggle()!.focus();
    await act(async () => h.publish(['kimi']));
    assert.equal(h.document.activeElement === h.toggle(), true);
    assert.deepEqual(h.changes, []);
  } finally { await h.close(); }
});

test('closing the last ordered page restores focus to finishing the mode without reopening it', async () => {
  const h = await fixture(['claude']);
  try {
    await h.click(h.toggle()!);
    h.document.querySelector<HTMLButtonElement>('.site-drag-handle')!.focus();
    await act(async () => h.publish([]));
    assert.equal(h.document.activeElement === h.toggle(), true);
    assert.equal(h.toggle()!.disabled, false);
    assert.equal(h.document.querySelectorAll('.site-drag-handle').length, 0);
    assert.deepEqual(h.changes, []);
  } finally { await h.close(); }
});

async function deferredParticipationFixture() {
  let controller!: ReturnType<typeof useSiteParticipation>, acknowledge!: () => void;
  const writes: Array<readonly SiteKey[]> = [];
  function Fixture() {
    const [opened, setOpened] = useState<readonly SiteKey[]>(['claude', 'kimi']);
    controller = useSiteParticipation({ opened, ready: true, onError: () => undefined,
      openPages: next => new Promise(resolve => {
        writes.push(next); setOpened(next); acknowledge = () => resolve(next);
      }) });
    return <><button id="outside-order">Another control</button><WorkspaceSites copy={getCopy('en')} sites={SITES} selected={new Set(opened)} participating={new Set(controller.participating)}
      participationBusy={controller.pending} groups={[]} onSelectionChange={next => { void controller.reorderOpened(next); }}
      onParticipationChange={next => { void controller.change(next); }} onSaveGroup={async () => true} onDeleteGroup={() => undefined} /></>;
  }
  const h = await mountDom(<Fixture />);
  await h.click(h.document.querySelector<HTMLButtonElement>('[data-sites-mode-toggle]')!);
  return { ...h, writes, controller: () => controller, acknowledge: () => acknowledge() };
}

test('a deferred page-order save restores the original keyboard handle after its disabled interval', async () => {
  const h = await deferredParticipationFixture();
  try {
    const handle = h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle')!;
    handle.focus();
    await act(async () => handle.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    assert.equal(h.controller().pending, true);
    assert.equal(handle.disabled, true);
    // JSDOM does not emulate Chromium's blur when a focused button becomes disabled.
    handle.blur();
    assert.equal(h.document.activeElement === h.document.body, true);
    await act(async () => h.acknowledge());
    assert.equal(handle.disabled, false);
    assert.equal(h.document.activeElement === handle, true, 'ACK must return the keyboard cursor to the same reordered site');
    await act(async () => handle.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
    assert.equal(h.writes.length, 2);
    assert.deepEqual(h.writes[1], ['claude', 'kimi']);
    await act(async () => h.acknowledge());
  } finally { await h.close(); }
});

test('a deferred page-order ACK preserves focus that the user moved to another control', async () => {
  const h = await deferredParticipationFixture();
  try {
    const handle = h.document.querySelector<HTMLButtonElement>('[data-site-key="claude"] .site-drag-handle')!;
    handle.focus();
    await act(async () => handle.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    handle.blur();
    const other = h.document.getElementById('outside-order')!;
    other.focus();
    await act(async () => h.acknowledge());
    assert.equal(h.document.activeElement === other, true, 'an ACK cannot steal a deliberate later focus');
    assert.equal(h.writes.length, 1);
  } finally { await h.close(); }
});
