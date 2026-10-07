import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createRef } from 'react';
import { CommandBar } from '../src/renderer/command-bar';
import { CommandPalette } from '../src/renderer/command-palette';
import { COMMANDS } from '../src/shared/commands';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const noop = () => undefined;
async function composer() {
  const batches: File[][] = [];
  const effects: string[] = [];
  const h = await mountDom(<CommandBar
    copy={getCopy('en')} promptRef={createRef()} text="Question" tier={null}
    runState="idle" auxiliaryBusy={false} layoutMode="overview" selectedCount={3}
    failureCount={0} cancelledCount={0} scopeLabel="Custom · 3" healthAttention={0}
    panelTab={null} imageControl={null} sendBlockedReason={null} synthesisPending={false}
    syncStatus={{ state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
    isMac={false} expanded={false} onTextChange={noop} onSubmit={() => effects.push('send')} onCancel={noop}
    onTierChange={noop} onLayoutChange={noop} onExpandedChange={value => effects.push(`expand:${value}`)}
    onPanelChange={noop} onShowGroupMenu={noop} onOpenMore={noop} onOpenArchive={noop} onRetry={noop}
    onPasteImages={files => batches.push([...files])}
  />);
  const area = h.document.querySelector('textarea')!;
  const dispatch = async (type: string, data: object) => {
    const event = new h.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
    await act(async () => { area.dispatchEvent(event); });
    return event;
  };
  return { ...h, area, effects, batches, dispatch };
}

test('image drops reach attachment selection and plain text drops keep browser behavior', async () => {
  const h = await composer();
  try {
    const image = new h.window.File(['png'], 'picture.png', { type: 'image/png' });
    const text = new h.window.File(['text'], 'note.txt', { type: 'text/plain' });
    const drag = await h.dispatch('dragover', { files: [], items: [{ kind: 'file', type: 'image/png' }] });
    assert.equal(drag.defaultPrevented, true);
    const imageDrop = await h.dispatch('drop', { files: [image, text] });
    assert.equal(imageDrop.defaultPrevented, true);
    assert.deepEqual(h.batches.map(batch => batch.map(file => file.name)), [['picture.png']]);
    const plainDrop = await h.dispatch('drop', { files: [text], items: [{ kind: 'file', type: 'text/plain' }] });
    assert.equal(plainDrop.defaultPrevented, false);
    assert.equal(h.batches.length, 1);
  } finally { await h.close(); }
});

test('pasted images reach attachment selection while accompanying text remains pasteable', async () => {
  const h = await composer();
  try {
    const image = new h.window.File(['png'], 'pasted.png', { type: 'image/png' });
    const paste = await h.dispatch('paste', { files: [image] });
    assert.equal(paste.defaultPrevented, false);
    assert.equal(h.batches[0][0].name, 'pasted.png');
  } finally { await h.close(); }
});

test('IME 229 confirmation and cancellation never send or collapse the prompt', async () => {
  const h = await composer();
  try {
    for (const [key, ctrlKey] of [['Enter', true], ['Escape', false]] as const) {
      const event = new h.window.KeyboardEvent('keydown', { key, ctrlKey, keyCode: 229, bubbles: true, cancelable: true });
      await act(async () => { h.area.dispatchEvent(event); });
      assert.equal(event.defaultPrevented, false);
    }
    assert.deepEqual(h.effects, []);
  } finally { await h.close(); }
});

test('IME 229 keeps command search open and never executes the highlighted command', async () => {
  const effects: string[] = [];
  const h = await mountDom(<CommandPalette
    copy={getCopy('en')} commands={COMMANDS} menuShortcuts={[]} groups={[]}
    library={{ templates: [], history: [] }} draft="Keep draft" isMac={false}
    mode="commands" onModeChange={noop} onExecute={id => effects.push(id)}
    onApplyGroup={noop} onInsertPrompt={noop} onSaveTemplate={noop}
    onDeleteTemplate={noop} onClose={() => effects.push('close')}
  />);
  try {
    const search = h.document.querySelector('input')!;
    for (const key of ['Escape', 'Enter']) {
      const event = new h.window.KeyboardEvent('keydown', { key, keyCode: 229, bubbles: true, cancelable: true });
      await act(async () => { search.dispatchEvent(event); });
      assert.equal(event.defaultPrevented, false);
    }
    assert.deepEqual(effects, []);
  } finally { await h.close(); }
});
