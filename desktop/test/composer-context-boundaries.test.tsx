import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createRef } from 'react';
import { PromptComposer } from '../src/renderer/prompt-composer';
import { useComposerSession } from '../src/renderer/use-composer-session';
import { getCopy } from '../src/shared/copy';
import type { DesktopSurface } from '../src/shared/protocol';
import { mountDom } from './ui/dom-harness';

test('replacing a draft invalidates the old selection even if the replacement text is identical', async () => {
  const ref = createRef<HTMLTextAreaElement>();
  const component = (revision: number) => <PromptComposer copy={getCopy('en')} promptRef={ref}
    text="The same draft body" revision={revision} expanded busy={false} isMac={false}
    onExpandedChange={() => undefined} onTextChange={() => undefined}
    onSubmit={() => undefined} onPasteImages={() => undefined} />;
  const h = await mountDom(component(1));
  try {
    const area = ref.current!;
    await act(async () => area.focus()); area.setSelectionRange(4, 9); area.scrollTop = 41;
    await act(async () => area.blur());
    await h.render(component(2));
    area.setSelectionRange(0, 0); area.scrollTop = 0;
    await act(async () => area.focus());
    assert.equal(area.selectionStart, 0); assert.equal(area.selectionEnd, 0);
    assert.equal(area.scrollTop, 0);
  } finally { await h.close(); }
});

test('only ordinary Escape collapses while IME keys retain input behavior and normal send stays singular', async () => {
  const collapsed: boolean[] = [], sends: string[] = [];
  const ref = createRef<HTMLTextAreaElement>();
  const h = await mountDom(<PromptComposer copy={getCopy('en')} promptRef={ref} text="Question"
    expanded busy={false} isMac={false} onExpandedChange={value => collapsed.push(value)}
    onTextChange={() => undefined} onSubmit={() => sends.push('send')} onPasteImages={() => undefined} />);
  try {
    const area = ref.current!;
    await act(async () => area.focus());
    for (const [key, ctrlKey, extra] of [['Escape', false, { isComposing: true }],
      ['Escape', false, { keyCode: 229 }], ['Enter', true, { keyCode: 229 }]] as const) {
      const event = new h.window.KeyboardEvent('keydown', { key, ctrlKey, ...extra, bubbles: true, cancelable: true });
      await act(async () => area.dispatchEvent(event));
      assert.equal(event.defaultPrevented, false);
    }
    assert.equal(collapsed.length, 0); assert.equal(sends.length, 0);
    for (const [key, ctrlKey] of [['Escape', false], ['Enter', true]] as const) {
      const event = new h.window.KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true });
      await act(async () => area.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true);
      assert.equal(h.document.activeElement === area, true);
    }
    assert.deepEqual(collapsed, [false]); assert.deepEqual(sends, ['send']);
  } finally { await h.close(); }
});

test('temporary covers retain editing intent while independent workspaces and explicit reset end it', async () => {
  function Session({ surface }: { surface: DesktopSurface }) {
    const session = useComposerSession(surface);
    return <div><output>{String(session.expanded)}</output>
      <button name="expand" onClick={() => session.setExpanded(true)}>Expand</button>
      <button name="reset" onClick={session.reset}>Reset</button></div>;
  }
  const h = await mountDom(<Session surface="sites" />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="expand"]')!);
    for (const surface of ['confirmation', 'question-history', 'sites'] as const) {
      await h.render(<Session surface={surface} />);
      assert.equal(h.document.querySelector('output')!.textContent, 'true');
    }
    for (const surface of ['archive', 'settings', 'commands'] as const) {
      await h.render(<Session surface={surface} />);
      assert.equal(h.document.querySelector('output')!.textContent, 'false');
      await h.render(<Session surface="sites" />);
      await h.click(h.document.querySelector<HTMLButtonElement>('[name="expand"]')!);
    }
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="reset"]')!);
    assert.equal(h.document.querySelector('output')!.textContent, 'false');
  } finally { await h.close(); }
});
