import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { FolderModal } from '../src/renderer/folder-modal';
import { BackupWorkspace } from '../src/renderer/backup-workspace';
import { getCopy } from '../src/shared/copy';
import type { BackupPreview } from '../src/shared/backup';
import { setShellApi } from '../src/renderer/shell-api';

const copy = getCopy('en');
const preview: BackupPreview = { token: 'fixture-preview', exportedAt: 1000, items: [
  { key: 'folder:f1', kind: 'folder', id: 'f1', title: 'Fixture folder', status: 'new', local: null, backup: { name: 'Fixture folder' } }
] };

async function mount(kind: 'folder' | 'backup', busy = false) {
  if (kind === 'backup') setShellApi({ previewBackupSelection: async () => ({ imported: 1, skipped: 0, keys: ['folder:f1'] }) } as any);
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<button id="opener">Open</button><div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let hostEscapes = 0;
  dom.window.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape') hostEscapes++; });
  const opener = dom.window.document.getElementById('opener') as HTMLButtonElement;
  opener.focus();
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  function Fixture() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    if (kind === 'backup') return <BackupWorkspace preview={preview} copy={copy} locale="en" onClose={() => setOpen(false)} onApplied={() => setOpen(false)} />;
    return <FolderModal copy={copy} title="Fixture folder" busy={busy} onCancel={() => setOpen(false)}>
      <input aria-label="Folder name" /><button hidden>Hidden action</button>
      <div inert><button>Inert action</button></div>
      <details><summary>Extra fields</summary><button>Closed detail action</button></details>
      <a id="source" href="https://example.com/source">Source</a>
      <textarea id="note" aria-label="Note" />
    </FolderModal>;
  }
  await act(async () => root.render(<Fixture />));
  const key = async (options: KeyboardEventInit) => {
    const event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
    await act(async () => dom.window.document.activeElement.dispatchEvent(event));
    return event as KeyboardEvent;
  };
  return { document: dom.window.document as Document, opener, key, hostEscapes: () => hostEscapes,
    async close() {
      await act(async () => root.unmount()); dom.window.close(); setShellApi(null);
      for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  };
}

for (const kind of ['folder', 'backup'] as const) {
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    test(`${kind} keeps composition Escape for the IME and blocks the host (${JSON.stringify(composition)})`, async () => {
      const h = await mount(kind);
      try {
        const event = await h.key({ key: 'Escape', ...composition });
        assert.equal(event.defaultPrevented, false, 'cancelling an IME candidate must keep the native default');
        assert.ok(h.document.querySelector('[role="dialog"]'), 'composition Escape must leave the editing surface open');
        assert.equal(h.hostEscapes(), 0, 'composition Escape must not reach the host close handler');
        await h.key({ key: 'Escape' });
        assert.ok(!h.document.querySelector('[role="dialog"]'), 'ordinary Escape still cancels');
        assert.ok(h.document.activeElement === h.opener, 'closing restores the original opener');
      } finally { await h.close(); }
    });
  }
}

test('folder traps around all visible controls and skips closed, hidden and inert content', async () => {
  const h = await mount('folder');
  try {
    const first = h.document.querySelector<HTMLButtonElement>('.folder-modal header button')!;
    const note = h.document.getElementById('note')!;
    assert.ok(h.document.activeElement === first);
    const backward = await h.key({ key: 'Tab', shiftKey: true });
    assert.equal(backward.defaultPrevented, true);
    assert.ok(h.document.activeElement === note, 'the last visible textarea follows source links, outside hidden detail content');
    const forward = await h.key({ key: 'Tab' });
    assert.equal(forward.defaultPrevented, true);
    assert.ok(h.document.activeElement === first);
    h.document.getElementById('source')!.focus();
    assert.equal((await h.key({ key: 'Tab' })).defaultPrevented, false, 'middle controls keep native Tab order');
    h.opener.focus();
    await h.key({ key: 'Tab' });
    assert.ok(h.document.activeElement === first, 'external focus is brought back into the modal');
  } finally { await h.close(); }
});

test('folder ignores cancellation while busy and focuses the panel when no controls remain', async () => {
  const h = await mount('folder', true);
  try {
    await h.key({ key: 'Escape' });
    assert.ok(h.document.querySelector('[role="dialog"]'), 'busy modal remains locked');
    const panel = h.document.querySelector<HTMLElement>('[role="dialog"]')!;
    for (const node of panel.querySelectorAll<HTMLElement>('button,input,textarea,summary,a')) node.hidden = true;
    h.opener.focus();
    await h.key({ key: 'Tab' });
    assert.ok(h.document.activeElement === panel, 'an empty focus circle falls back to its panel');
  } finally { await h.close(); }
});

test('backup Escape leaves confirmation before closing and stays locked while applying', async () => {
  const h = await mount('backup');
  let finish!: (value: { imported: number; skipped: number }) => void;
  setShellApi({ applyBackup: async () => new Promise(resolve => { finish = resolve; }) } as any);
  try {
    const review = () => h.document.querySelector<HTMLButtonElement>('.backup-footer button')!;
    await act(async () => review().click());
    assert.ok(h.document.querySelector('.backup-summary'));
    await h.key({ key: 'Escape' });
    assert.ok(h.document.querySelector('.backup-body'), 'Escape returns to comparison rather than closing');
    await act(async () => review().click());
    await act(async () => review().click());
    await h.key({ key: 'Escape' });
    assert.ok(h.document.querySelector('[aria-busy="true"]'), 'applying prevents dismissal');
    h.opener.focus(); await h.key({ key: 'Tab' });
    assert.ok(h.document.activeElement === h.document.querySelector('.backup-workspace'), 'all disabled controls fall back to the panel');
    await act(async () => finish({ imported: 1, skipped: 0 }));
    assert.ok(h.document.activeElement === h.opener);
  } finally { await h.close(); }
});
