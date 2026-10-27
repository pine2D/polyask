import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { getCopy } from '../src/shared/copy';
import { executeCommand } from '../src/renderer/command-dispatcher';
import { requestSurfaceChange } from '../src/renderer/surface-transition';
import type { DesktopSurface } from '../src/shared/protocol';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { settingsElement, settingsShell } from './ui/settings-dom';
import { customProxy, proxyStateFixture } from './ui/proxy-state-fixture';

const copy = getCopy('en');
async function fixture(saveGate?: Promise<{ ok: true }>, applyGate?: Promise<{ imported: number; skipped: number }>) {
  const writes: string[] = [], effects: string[] = [], cancelledBackups: string[] = [];
  let push: (value: unknown) => void = () => {};
  let state = proxyStateFixture({ applied: customProxy, formValue: customProxy });
  settingsShell({ getProxyState: async () => state, onProxyState: (next: typeof push) => { push = next; return () => {}; },
    saveProxy: async () => { writes.push('save'); return saveGate ?? { ok: true }; },
    previewBackup: async () => ({ token: 'synthetic-preview', exportedAt: 1000, items: [
      { key: 'archive:a', id: 'a', kind: 'archive', status: 'new', title: 'Synthetic answer', local: null, backup: { task: 'Synthetic answer' } }
    ] }),
    previewBackupSelection: async (_token: string, keys: string[]) => ({ imported: keys.length, skipped: 0, keys }),
    cancelBackup: async (token: string) => { cancelledBackups.push(token); },
    applyBackup: async () => { writes.push('apply'); return applyGate ?? { imported: 1, skipped: 0 }; } });
  function Fixture() {
    const [surface, setSurface] = useState<DesktopSurface>('settings'), [section, setSection] = useState(0);
    const leave = (next: DesktopSurface) => requestSurfaceChange(surface, next, {
      surfaceChanged: () => {}, closeHistory: () => {}, closeImages: () => {}, resetComposer: () => {}, closeDrawer: () => {},
      commit: value => { effects.push(value); setSurface(value); }
    });
    return <>
      <button id="navigate-archive" onClick={() => executeCommand('open-archive', { 'open-archive': () => leave('archive') })}>Archive</button>
      <button id="navigate-sites" onClick={() => executeCommand('focus-prompt', { 'focus-prompt': () => leave('sites') })}>Sites</button>
      <button id="same-settings" onClick={() => executeCommand('open-display-settings', { 'open-display-settings': () => setSection(v => v + 1) })}>Display</button>
      {surface === 'settings' ? settingsElement({ onClose: () => leave('sites'),
        initialSection: section ? 'display' : 'proxy', sectionRequest: section }) : <button id="reopen" onClick={() => setSurface('settings')}>Reopen</button>}
    </>;
  }
  const h = await mountDom(<Fixture />);
  const host = () => h.document.getElementById('settings-proxy-host') as HTMLInputElement;
  const password = () => h.document.getElementById('settings-proxy-password') as HTMLInputElement;
  const cancel = () => h.document.querySelector<HTMLButtonElement>('.confirm-actions button:not(.primary)')!;
  const confirm = () => h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!;
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!;
  return { ...h, host, password, cancel, confirm, writes, effects, cancelledBackups,
    openBackup: async () => { await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=backup]')!); await h.click(button(copy.backupImport)); },
    closeBackup: async () => { await h.click(h.document.querySelector<HTMLElement>('.backup-header button')!); await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=network]')!); },
    button,
    push: async () => { state = { ...state, formValue: { ...customProxy, host: 'synced.example' } }; await act(async () => push(state)); },
    close: async () => { await h.close(); setShellApi(null); } };
}

for (const via of ['close', 'escape', 'command'] as const) test(`unsaved proxy edits survive cancel and only discard on confirmed ${via}`, async () => {
  const h = await fixture();
  try {
    await h.input(h.host(), 'draft.example'); await h.input(h.password(), 'synthetic-secret');
    assert.equal(h.document.querySelector('[data-proxy-unsaved]') === null, false);
    if (via === 'close') await h.click(h.document.querySelector('.settings-toolbar button')!);
    if (via === 'command') await h.click(h.document.getElementById('navigate-archive')!);
    if (via === 'escape') await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(h.document.querySelector('.confirm-dialog') === null, false);
    assert.equal(h.effects.length, 0); assert.equal(h.writes.length, 0);
    await h.click(h.cancel());
    assert.equal(h.host().value, 'draft.example'); assert.equal(h.password().value, 'synthetic-secret');
    await h.click(h.document.getElementById('navigate-archive')!);
    await h.click(h.confirm());
    assert.deepEqual(h.effects, ['archive']); assert.equal(h.writes.length, 0);
    await h.click(h.document.getElementById('reopen')!);
    assert.equal(h.host().value, 'proxy.example'); assert.equal(h.password().value, '');
  } finally { await h.close(); }
});

test('password-only edit, changed-back fields, same-surface commands and IME retain their semantics', async () => {
  const h = await fixture();
  try {
    await h.input(h.host(), 'changed'); await h.input(h.host(), 'proxy.example');
    assert.equal(h.document.querySelector('[data-proxy-unsaved]') === null, true);
    await h.input(h.password(), 'synthetic-secret');
    await h.click(h.document.getElementById('same-settings')!);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    assert.equal(h.password().value, 'synthetic-secret');
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', keyCode: 229, bubbles: true })));
    assert.equal(h.effects.length, 0);
    await h.click(h.document.getElementById('navigate-archive')!);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, false);
    await h.click(h.cancel()); assert.equal(h.password().value, 'synthetic-secret');
  } finally { await h.close(); }
});

test('sync changes keep the proxy draft, and repeated leaving commands retain the first target', async () => {
  const h = await fixture();
  try {
    await h.input(h.host(), 'draft.example'); await h.push();
    assert.equal(h.host().value, 'draft.example');
    await h.click(h.document.getElementById('navigate-archive')!);
    await h.click(h.document.getElementById('navigate-sites')!);
    await h.click(h.cancel());
    assert.equal(h.host().value, 'draft.example'); assert.equal(h.effects.length, 0);
    await h.click(h.document.getElementById('navigate-archive')!);
    await h.click(h.document.getElementById('navigate-sites')!);
    await h.click(h.confirm()); assert.deepEqual(h.effects, ['archive']);
  } finally { await h.close(); }
});

test('a late explicit save clears an obsolete leave confirmation without navigating', async () => {
  let finish!: (value: { ok: true }) => void;
  const gate = new Promise<{ ok: true }>(resolve => { finish = resolve; });
  const h = await fixture(gate);
  try {
    await h.input(h.host(), 'draft.example');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === copy.proxySave)!);
    await h.click(h.document.getElementById('navigate-archive')!);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, false);
    await act(async () => { finish({ ok: true }); });
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    assert.equal(h.document.querySelector('.settings-workspace') === null, false);
    assert.equal(h.effects.length, 0); assert.deepEqual(h.writes, ['save']);
  } finally { await h.close(); }
});

for (const edit of ['before-preview', 'after-preview'] as const) for (const via of ['close', 'escape'] as const) {
  test(`proxy ${via} protection remains after backup cancellation with edits ${edit}`, async () => {
    const h = await fixture();
    const change = async () => { await h.input(h.host(), 'draft.example'); await h.input(h.password(), 'synthetic-secret'); };
    const leave = () => via === 'close' ? h.click(h.document.querySelector('.settings-toolbar button')!)
      : act(async () => { h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    try {
      if (edit === 'before-preview') await change();
      await h.openBackup(); await h.closeBackup();
      if (edit === 'after-preview') await change();
      await leave();
      assert.equal(h.document.querySelector('.confirm-dialog') === null, false, 'proxy edits still require approval after closing preview');
      assert.deepEqual(h.effects, []); assert.deepEqual(h.writes, []);
      await h.click(h.cancel());
      assert.equal(h.host().value, 'draft.example'); assert.equal(h.password().value, 'synthetic-secret');
      await leave(); await h.click(h.confirm());
      assert.deepEqual(h.effects, ['sites']); assert.deepEqual(h.cancelledBackups, ['synthetic-preview', 'pending']);
    } finally { await h.close(); }
  });
}

test('a navigation command closes backup preview but awaits proxy approval before any navigation effects', async () => {
  const h = await fixture();
  try {
    await h.input(h.host(), 'draft.example'); await h.input(h.password(), 'synthetic-secret');
    await h.openBackup(); await h.click(h.document.getElementById('navigate-archive')!);
    assert.equal(h.document.querySelector('.backup-workspace') === null, true);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, false, 'preview approval cannot bypass proxy approval');
    assert.deepEqual(h.effects, []); assert.deepEqual(h.writes, []);
    await h.click(h.cancel());
    assert.equal(h.host().value, 'draft.example'); assert.equal(h.password().value, 'synthetic-secret');
    await h.openBackup(); await h.click(h.document.getElementById('navigate-archive')!);
    await h.click(h.document.getElementById('navigate-sites')!); await h.click(h.confirm());
    assert.deepEqual(h.effects, ['archive']); assert.deepEqual(h.writes, []);
    assert.deepEqual(h.cancelledBackups, ['synthetic-preview', 'synthetic-preview', 'pending']);
  } finally { await h.close(); }
});

test('backup application blocks navigation and retains proxy protection after application completes', async () => {
  let finish!: (value: { imported: number; skipped: number }) => void;
  const gate = new Promise<{ imported: number; skipped: number }>(resolve => { finish = resolve; });
  const h = await fixture(undefined, gate);
  try {
    await h.input(h.host(), 'draft.example'); await h.openBackup();
    await h.click(h.button(copy.backupReviewSummary)); await h.click(h.button(copy.backupConfirm));
    await h.click(h.document.getElementById('navigate-archive')!);
    assert.equal(h.document.querySelector('.backup-workspace') === null, false);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    assert.deepEqual(h.effects, []); assert.deepEqual(h.writes, ['apply']);
    await act(async () => { finish({ imported: 1, skipped: 0 }); });
    await h.click(h.document.getElementById('navigate-archive')!);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, false);
    await h.click(h.cancel()); assert.equal(h.host().value, 'draft.example');
    assert.deepEqual(h.effects, []);
  } finally { await h.close(); }
});
