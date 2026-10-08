import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { historyMount, waitFor } from './ui/history-dom';
import { usePresence } from '../src/renderer/presence';
import { ImagePicker } from '../src/renderer/image-picker';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

test('history retains its reader and native cover through exit and cancels the exit on reopen', async () => {
  const surfaces: string[] = [];
  const h = await historyMount({ setSurface: (value: string) => surfaces.push(value) });
  try {
    await waitFor(() => !!h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLButtonElement>('.question-main')!);
    await waitFor(() => h.document.body.textContent?.includes('LATEST CLAUDE BODY'));
    await h.rerender({ open: false });
    assert.equal(h.document.querySelector('.question-history') === null, false, 'leave the rendered panel in place until its exit completes');
    assert.equal(h.document.querySelector('.question-history')?.getAttribute('aria-hidden'), 'true');
    assert.equal(h.document.querySelector('.question-history')?.hasAttribute('inert'), true);
    assert.equal(h.document.body.textContent?.includes('LATEST CLAUDE BODY'), true);
    assert.equal(surfaces.at(-1), 'question-history');
    await h.rerender({ open: true });
    await act(async () => { await new Promise(r => setTimeout(r, 190)); });
    assert.equal(h.document.querySelector('.question-history')?.hasAttribute('inert'), false);
    assert.equal(h.document.body.textContent?.includes('LATEST CLAUDE BODY'), true);
    await h.rerender({ open: false });
    await waitFor(() => h.document.querySelector('.question-history') === null);
    assert.equal(surfaces.at(-1), 'sites');
  } finally { await h.close(); }
});

test('attachment tray remains inert during exit while its width is reserved', async () => {
  const image = { name: 'fixture.png', type: 'image/png' as const, size: 10, dataUrl: 'data:image/png;base64,AA==' };
  function Attachments() {
    const [open, setOpen] = useState(true);
    const present = usePresence(open, 140);
    return <main data-reserved={String(present)}><button name="toggle" onClick={() => setOpen(!open)}>Toggle</button>
      <ImagePicker present={present} copy={getCopy('en')} images={[image]} open={open}
        disabled={false} warning={null} warningCount={0} error={null} onOpenChange={setOpen}
        onFiles={() => {}} onRemove={() => {}} onAdjustScope={() => {}} /></main>;
  }
  const h = await mountDom(<Attachments />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="toggle"]')!);
    assert.equal(h.document.querySelector('#image-tray') === null, false);
    assert.equal(h.document.querySelector('#image-tray')?.hasAttribute('inert'), true);
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true');
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="toggle"]')!);
    await act(async () => { await new Promise(r => setTimeout(r, 190)); });
    assert.equal(h.document.querySelector('#image-tray')?.hasAttribute('inert'), false);
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="toggle"]')!);
    await waitFor(() => h.document.querySelector('#image-tray') === null);
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'false');
  } finally { await h.close(); }
});

test('history exit cannot restore native pages over a newer confirmation surface', async () => {
  const surfaces: string[] = [];
  const h = await historyMount({ setSurface: (value: string) => surfaces.push(value) });
  try {
    await h.rerender({ open: false });
    surfaces.push('confirmation');
    await h.rerender({ active: false });
    assert.equal(h.document.querySelector('.question-history') === null, true);
    await act(async () => { await new Promise(r => setTimeout(r, 190)); });
    assert.equal(surfaces.at(-1), 'confirmation', 'the newer surface owns native visibility');
  } finally { await h.close(); }
});
