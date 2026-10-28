import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import test from 'node:test';
import { CommandPalette, type CommandPaletteMode } from '../src/renderer/command-palette';
import { ConfirmDialog } from '../src/renderer/confirm-dialog';
import { COMMANDS } from '../src/shared/commands';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en'), noop = () => {};
function Host({ initialMode = 'commands' }: { initialMode?: CommandPaletteMode }) {
  const [open, setOpen] = useState(true), [mode, setMode] = useState(initialMode);
  const [confirm, setConfirm] = useState(false);
  return <>{open ? <CommandPalette copy={copy} commands={COMMANDS} menuShortcuts={[]} groups={[]}
    library={{ templates: [], history: [] }} draft="" isMac={false} mode={mode} onModeChange={setMode}
    onExecute={() => setConfirm(true)} onApplyGroup={noop} onInsertPrompt={noop}
    onSaveTemplate={noop} onDeleteTemplate={noop} onClose={() => setOpen(false)} /> : <p>Closed</p>}
    {confirm ? <ConfirmDialog copy={copy} title="Confirm" message="Keep the palette open" confirmLabel="Confirm"
      cancelLabel="Cancel" onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} /> : null}</>;
}

for (const mode of ['commands', 'shortcuts', 'library', 'guide'] as const) {
  test(`${mode}: outside click closes the palette; clicks inside keep it open`, async () => {
    const h = await mountDom(<Host initialMode={mode} />);
    try {
      await h.click(h.document.querySelector<HTMLElement>('.command-palette')!);
      assert.equal(h.document.querySelector('.command-palette') !== null, true);
      await h.click(h.document.querySelector<HTMLElement>('.command-surface')!);
      assert.equal(h.document.querySelector('.command-palette') === null, true);
    } finally { await h.close(); }
  });
}

test('Escape closes the palette after keyboard focus leaves its controls', async () => {
  const h = await mountDom(<Host />);
  try {
    (h.document.activeElement as HTMLElement).blur();
    assert.equal(h.document.activeElement === h.document.body, true);
    const event = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => h.document.body.dispatchEvent(event));
    assert.equal(h.document.querySelector('.command-palette') === null, true);
    assert.equal(event.defaultPrevented, true);
    // Unmounting releases the window listener.
    const after = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    h.document.body.dispatchEvent(after);
    assert.equal(after.defaultPrevented, false);
  } finally { await h.close(); }
});

test('IME Escape and an already handled Escape leave the palette open', async () => {
  const h = await mountDom(<Host />);
  try {
    for (const init of [{ isComposing: true }, { keyCode: 229 }, {}]) {
      const event = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
      if (!Object.keys(init).length) event.preventDefault();
      await act(async () => h.document.body.dispatchEvent(event));
      assert.equal(h.document.querySelector('.command-palette') !== null, true);
      assert.equal(event.defaultPrevented, !Object.keys(init).length);
    }
  } finally { await h.close(); }
});

test('Escape dismisses a nested confirmation before the palette', async () => {
  const h = await mountDom(<Host />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('#command-results button')!);
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
    await act(async () => h.document.activeElement!.dispatchEvent(
      new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
    assert.equal(h.document.querySelector('.command-palette') !== null, true);
    await act(async () => h.document.activeElement!.dispatchEvent(
      new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(h.document.querySelector('.command-palette') === null, true);
  } finally { await h.close(); }
});
