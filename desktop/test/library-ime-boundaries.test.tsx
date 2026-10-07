import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { LibraryMenu } from '../src/renderer/library-menu';
import { LibrarySelect } from '../src/renderer/library-select';
import { ImagePicker } from '../src/renderer/image-picker';
import { ConfirmDialog } from '../src/renderer/confirm-dialog';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

async function mount(kind: 'menu' | 'select' | 'images', withConfirmation = false) {
  function Fixture() {
    const [value, setValue] = useState('draft');
    const [open, setOpen] = useState(true);
    const [confirming, setConfirming] = useState(withConfirmation);
    if (kind === 'menu') return <LibraryMenu label="Actions" actions={[{ label: 'Keep record', run: () => {} }]} />;
    if (kind === 'select') return <><LibrarySelect label="Status" searchLabel="Find status" value={value}
      options={[{ value: 'draft', label: 'Draft' }, { value: 'final', label: 'Final' }]} onChange={setValue} /><output>{value}</output></>;
    return <><ImagePicker copy={getCopy('en')} images={[{ name: 'fixture.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==' }]}
      open={open} disabled={false} warning={null} warningCount={0} error={null} onOpenChange={setOpen}
      onFiles={() => {}} onRemove={() => {}} onAdjustScope={() => {}} />
      {confirming ? <ConfirmDialog copy={getCopy('en')} title="Confirm fixture" message="Keep images while cancelling this dialog."
        confirmLabel="Apply" cancelLabel="Cancel" onConfirm={() => setConfirming(false)} onCancel={() => setConfirming(false)} /> : null}</>;
  }
  const h = await mountDom(<Fixture />);
  const resize = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  h.window.HTMLElement.prototype.scrollIntoView = () => {};
  let hostEscapes = 0;
  h.window.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape') hostEscapes++; });
  const key = async (options: KeyboardEventInit) => {
    const event = new h.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
    await act(async () => h.document.activeElement!.dispatchEvent(event));
    return event as KeyboardEvent;
  };
  return { ...h, key, hostEscapes: () => hostEscapes,
    async close() {
      await h.close();
      if (resize) Object.defineProperty(globalThis, 'ResizeObserver', resize); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  };
}

test('image tray preserves ordinary Escape priority for a nested confirmation', async () => {
  const h = await mount('images', true);
  try {
    await h.key({ key: 'Escape' });
    assert.ok(!h.document.querySelector('[role="dialog"]'), 'ordinary Escape cancels the nested confirmation');
    assert.ok(h.document.querySelector('#image-tray'), 'cancelling confirmation must not dismiss the image tray below it');
  } finally { await h.close(); }
});

for (const kind of ['menu', 'select', 'images'] as const) {
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    test(`${kind} preserves IME Escape and shields host cancellation (${JSON.stringify(composition)})`, async () => {
      const h = await mount(kind);
      try {
        const trigger = h.document.querySelector<HTMLButtonElement>('button')!;
        const surface = kind === 'menu' ? '[role="menu"]' : kind === 'select' ? '[role="listbox"]' : '#image-tray';
        if (kind !== 'images') await h.click(trigger);
        else h.document.querySelector<HTMLButtonElement>('.image-replace')!.focus();
        const event = await h.key({ key: 'Escape', ...composition });
        assert.equal(event.defaultPrevented, false, 'IME candidate cancellation retains its native default');
        assert.ok(h.document.querySelector(surface), 'IME cancellation keeps the active surface');
        assert.equal(h.hostEscapes(), 0, 'IME cancellation does not close a containing surface');
        await h.key({ key: 'Escape' });
        assert.ok(!h.document.querySelector(surface), 'ordinary Escape still dismisses the active surface');
        assert.ok(h.document.activeElement === trigger, 'dismissal restores trigger focus');
      } finally { await h.close(); }
    });
  }
}

for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
  test(`library select keeps IME Enter from opening or choosing an option (${JSON.stringify(composition)})`, async () => {
    const h = await mount('select');
    try {
      const trigger = h.document.querySelector<HTMLButtonElement>('button')!;
      trigger.focus();
      const closedEvent = await h.key({ key: 'Enter', ...composition });
      assert.equal(closedEvent.defaultPrevented, false);
      assert.ok(!h.document.querySelector('[role="listbox"]'), 'composition Enter does not open a selector');
      await h.click(trigger);
      await h.key({ key: 'ArrowDown' });
      const openEvent = await h.key({ key: 'Enter', ...composition });
      assert.equal(openEvent.defaultPrevented, false);
      assert.equal(h.document.querySelector('output')!.textContent, 'draft', 'candidate confirmation must not choose the highlighted option');
      assert.ok(h.document.querySelector('[role="listbox"]'));
      await h.key({ key: 'Enter' });
      assert.equal(h.document.querySelector('output')!.textContent, 'final', 'ordinary Enter chooses the highlighted option');
      assert.ok(!h.document.querySelector('[role="listbox"]'));
      assert.ok(h.document.activeElement === trigger);
    } finally { await h.close(); }
  });
}
