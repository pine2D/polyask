import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createRef, useState } from 'react';
import { PromptComposer } from '../src/renderer/prompt-composer';
import { ImagePicker } from '../src/renderer/image-picker';
import { focusPromptForEditing, restoreWorkbenchFocus } from '../src/renderer/composer-activation';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

async function editingSession() {
  const ref = createRef<HTMLTextAreaElement>();
  function Session() {
    const [expanded, setExpanded] = useState(false);
    const [tray, setTray] = useState(true);
    const [text, setText] = useState('A draft with an editing position');
    const copy = getCopy('en');
    return <><button name="outside" className="scope-main">Workbench</button>
      <PromptComposer copy={copy} promptRef={ref} text={text} expanded={expanded}
        busy={false} isMac={false} onExpandedChange={setExpanded} onTextChange={setText}
        onSubmit={() => undefined} onPasteImages={() => undefined} />
      <button name="edit" onClick={() => focusPromptForEditing(ref, setExpanded)}>Edit draft</button>
      <ImagePicker copy={copy} images={[{ name: 'local.png', type: 'image/png', size: 1,
        dataUrl: 'data:image/png;base64,AA==' }]} open={tray} disabled={false}
        warning={null} warningCount={0} error={null} onOpenChange={setTray}
        onFiles={() => undefined} onRemove={() => undefined} onAdjustScope={() => undefined} />
    </>;
  }
  const h = await mountDom(<Session />);
  const area = ref.current!;
  const expanded = () => h.document.querySelector('[data-composer-toggle]')!.getAttribute('aria-expanded');
  const focus = async (node: HTMLElement) => { await act(async () => node.focus()); };
  const point = async () => { await act(async () => {
    area.dispatchEvent(new h.window.MouseEvent('pointerdown', { button: 0, bubbles: true }));
    area.focus();
  }); };
  const key = async (node: HTMLElement, value: string, extra: KeyboardEventInit = {}) => {
    const event = new h.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
    await act(async () => node.dispatchEvent(event));
    return event;
  };
  return { ...h, area, expanded, focus, point, key };
}

test('passive focus restoration preserves collapsed draft, selection and scroll', async () => {
  const h = await editingSession();
  try {
    await h.point(); h.area.setSelectionRange(3, 9, 'backward'); h.area.scrollTop = 45;
    await h.key(h.area, 'Escape');
    assert.equal(h.expanded(), 'false');
    await h.focus(h.document.querySelector<HTMLButtonElement>('[name="outside"]')!);
    h.area.setSelectionRange(0, 0); h.area.scrollTop = 0;
    await h.focus(h.area);
    assert.equal(h.expanded(), 'false', 'restoring focus must not override explicit collapse');
    assert.equal(h.area.selectionStart, 3); assert.equal(h.area.selectionEnd, 9);
    assert.equal(h.area.selectionDirection, 'backward'); assert.equal(h.area.scrollTop, 45);
    assert.equal(h.area.value, 'A draft with an editing position');
  } finally { await h.close(); }
});

test('clicking the already focused collapsed input explicitly reopens editing', async () => {
  const h = await editingSession();
  try {
    await h.point(); await h.key(h.area, 'Escape');
    assert.equal(h.document.activeElement === h.area, true);
    await h.point();
    assert.equal(h.expanded(), 'true');
    await h.key(h.area, 'Escape'); await h.input(h.area, 'Continue typing');
    assert.equal(h.expanded(), 'false', 'ordinary typing retains explicit collapse');
  } finally { await h.close(); }
});

test('only intentional Tab entry expands, not stale, prevented, modified or IME Tab', async () => {
  const h = await editingSession();
  try {
    const outside = h.document.querySelector<HTMLButtonElement>('[name="outside"]')!;
    await h.focus(outside); await h.key(outside, 'Tab'); await h.focus(h.area);
    assert.equal(h.expanded(), 'true'); await h.key(h.area, 'Escape');
    for (const extra of [{ ctrlKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      await h.focus(outside); await h.key(outside, 'Tab', extra); await h.focus(h.area);
      assert.equal(h.expanded(), 'false');
    }
    await h.focus(outside);
    outside.addEventListener('keydown', event => event.preventDefault(), { once: true });
    await h.key(outside, 'Tab'); await h.focus(h.area);
    assert.equal(h.expanded(), 'false');
    await h.focus(outside); await h.key(outside, 'Tab');
    await act(async () => h.window.dispatchEvent(new h.window.Event('blur')));
    await h.focus(h.area); assert.equal(h.expanded(), 'false');
  } finally { await h.close(); }
});

test('Escape collapses the input once before closing attachments, and IME closes neither', async () => {
  const h = await editingSession();
  try {
    await h.point(); await h.key(h.area, 'Escape', { isComposing: true });
    assert.equal(h.expanded(), 'true');
    assert.equal(h.document.querySelector('.image-trigger')!.getAttribute('aria-expanded'), 'true');
    const first = await h.key(h.area, 'Escape');
    assert.equal(first.defaultPrevented, true); assert.equal(h.expanded(), 'false');
    assert.equal(h.document.querySelector('.image-trigger')!.getAttribute('aria-expanded'), 'true');
    await h.key(h.area, 'Escape');
    assert.equal(h.document.querySelector('.image-trigger')!.getAttribute('aria-expanded'), 'false');
  } finally { await h.close(); }
});

test('Escape from the attachment controls leaves the expanded input intact', async () => {
  const h = await editingSession();
  try {
    await h.point();
    const button = h.document.querySelector<HTMLButtonElement>('.image-tray-close')!;
    await h.focus(button); await h.key(button, 'Escape');
    assert.equal(h.expanded(), 'true');
    assert.equal(h.document.querySelector('.image-trigger')!.getAttribute('aria-expanded'), 'false');
    assert.equal(h.document.activeElement === h.document.querySelector('.image-trigger'), true);
  } finally { await h.close(); }
});

test('the explicit focus action reopens an already focused input without replacing its selection', async () => {
  const h = await editingSession();
  try {
    await h.point(); h.area.setSelectionRange(3, 9, 'backward');
    await h.key(h.area, 'Escape');
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="edit"]')!);
    assert.equal(h.expanded(), 'true'); assert.equal(h.document.activeElement === h.area, true);
    assert.equal(h.area.selectionStart, 3); assert.equal(h.area.selectionEnd, 9);
  } finally { await h.close(); }
});

test('dialog restoration keeps an existing focus target and otherwise falls back to the workbench', async () => {
  const h = await editingSession();
  try {
    await h.focus(h.area);
    await act(async () => restoreWorkbenchFocus());
    assert.equal(h.document.activeElement === h.area, true); assert.equal(h.expanded(), 'false');
    await act(async () => { h.area.blur(); restoreWorkbenchFocus(); });
    assert.equal(h.document.activeElement === h.document.querySelector('.scope-main'), true);
    assert.equal(h.expanded(), 'false');
  } finally { await h.close(); }
});
