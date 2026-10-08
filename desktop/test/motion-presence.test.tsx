import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { usePresence } from '../src/renderer/presence';
import { useComposerSession } from '../src/renderer/use-composer-session';
import { mountDom } from './ui/dom-harness';

function media() {
  const listeners = new Set<() => void>();
  const query = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
  return { query, set(reduce: boolean) { query.matches = reduce; listeners.forEach(fn => fn()); }, listeners };
}

test('a panel with no exit animation releases its space immediately', async () => {
  const m = media();
  function Pane({ open }: { open: boolean }) {
    window.matchMedia = () => m.query as unknown as MediaQueryList;
    return usePresence(open, 0) ? <aside>Panel</aside> : null;
  }
  const h = await mountDom(<Pane open />);
  try {
    await h.render(<Pane open={false} />);
    assert.equal(h.document.querySelector('aside') === null, true);
  } finally { await h.close(); }
});

test('reopening a closing panel cancels its removal; reducing motion finishes a later exit', async () => {
  const m = media();
  function Pane({ open }: { open: boolean }) {
    window.matchMedia = () => m.query as unknown as MediaQueryList;
    return usePresence(open, 80) ? <aside aria-hidden={!open}>Panel</aside> : null;
  }
  const h = await mountDom(<Pane open />);
  try {
    await h.render(<Pane open={false} />);
    assert.equal(h.document.querySelector('aside')?.getAttribute('aria-hidden'), 'true');
    await h.render(<Pane open />);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 110)); });
    assert.equal(h.document.querySelector('aside')?.getAttribute('aria-hidden'), 'false');
    await h.render(<Pane open={false} />);
    await act(async () => m.set(true));
    assert.equal(h.document.querySelector('aside') === null, true);
  } finally { await h.close(); }
  assert.equal(m.listeners.size, 0);
});

test('composer keeps the native space through collapse and a quick reversal retains the editing node', async () => {
  const m = media();
  function Composer() {
    window.matchMedia = () => m.query as unknown as MediaQueryList;
    const session = useComposerSession('sites');
    const reserve = session.reservedExpanded;
    const [text, setText] = useState('Original draft');
    return <main data-reserved={String(reserve)}><textarea value={text} onChange={e => setText(e.target.value)} />
      <button onClick={() => session.setExpanded(!session.expanded)}>Toggle</button>
      <output>{String(session.expanded)}</output></main>;
  }
  const h = await mountDom(<Composer />);
  try {
    const area = h.document.querySelector('textarea')!;
    await h.click(h.document.querySelector('button')!);
    await h.click(h.document.querySelector('button')!);
    assert.equal(h.document.querySelector('output')!.textContent, 'false');
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true', 'collapse must finish before shrinking native pages');
    await h.click(h.document.querySelector('button')!);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 190)); });
    assert.equal(h.document.querySelector('textarea') === area, true);
    assert.equal(area.value, 'Original draft');
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true');
    await h.click(h.document.querySelector('button')!);
    await act(async () => m.set(true));
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'false');
  } finally { await h.close(); }
});
