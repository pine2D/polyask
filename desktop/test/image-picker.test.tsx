import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ImagePicker } from '../src/renderer/image-picker';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

test('add and replace use the same native file input, preserve file order and allow repeat selection', async () => {
  const batches: string[][] = [];
  let opens = 0;
  const copy = getCopy('en');
  const element = (attached: boolean) => <ImagePicker copy={copy} open={attached} images={attached ? [{ name: 'saved.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==' }] : []}
    disabled={false} warning={null} warningCount={0} error={null} onOpenChange={() => {}} onRemove={() => {}}
    onAdjustScope={() => {}} onFiles={files => batches.push(files.map(f => f.name))} />;
  const h = await mountDom(element(false));
  try {
    const input = h.document.querySelector<HTMLInputElement>('input[type=file]')!;
    input.click = () => { opens++; };
    await h.click(h.document.querySelector('.image-trigger')!);
    assert.equal(opens, 1);
    const files = [new h.window.File(['first'], 'one.png', { type: 'image/png' }), new h.window.File(['second'], 'two.jpg', { type: 'image/jpeg' })];
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await act(async () => input.dispatchEvent(new h.window.Event('change', { bubbles: true })));
    await h.render(element(true));
    await h.click(h.document.querySelector('.image-replace')!);
    assert.equal(opens, 2);
    await act(async () => input.dispatchEvent(new h.window.Event('change', { bubbles: true })));
    assert.deepEqual(batches, [['one.png', 'two.jpg'], ['one.png', 'two.jpg']]);
  } finally { await h.close(); }
});


test('a native picker opened before history restoration cannot replace the restored batch', async () => {
  const batches: string[][] = []; let intent = 0;
  const h = await mountDom(<ImagePicker copy={getCopy('en')} open={false} images={[]} disabled={false}
    warning={null} warningCount={0} error={null} onOpenChange={() => {}} onRemove={() => {}}
    onAdjustScope={() => {}} onFiles={files => batches.push(files.map(f => f.name))} selectionIntent={() => intent} />);
  try {
    const input = h.document.querySelector<HTMLInputElement>('input[type=file]')!; input.click = () => {};
    await h.click(h.document.querySelector<HTMLElement>('.image-trigger')!);
    intent++; // The original picker is still open when history atomically replaces the draft.
    Object.defineProperty(input, 'files', { configurable: true, value: [new h.window.File(['late'], 'late.png', { type: 'image/png' })] });
    await act(async () => input.dispatchEvent(new h.window.Event('change', { bubbles: true })));
    assert.equal(batches.length, 0, 'late native selection must not overwrite a history restoration');
  } finally { await h.close(); }
});
