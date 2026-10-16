import assert from 'node:assert/strict';
import test from 'node:test';
import { useWorkspaceMotion } from '../src/renderer/use-workspace-motion';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import type { LayoutState } from '../src/shared/protocol';

test('composer waits for the native expanded geometry before revealing over the webpages', async () => {
  const requests: boolean[] = [];
  setShellApi({ setDrawerOpen: () => {}, setComposerExpanded: (value: boolean) => { requests.push(value); } } as any);
  const layout = (y: number): LayoutState => ({ mode: 'overview', page: 0, pageCount: 1, focused: 'claude',
    placements: [{ key: 'claude', bounds: { x: 4, y, width: 800, height: 400 } }] });
  function Fixture({ y }: { y: number }) {
    const { composer } = useWorkspaceMotion('sites', false, 'pointer', false, { layout: layout(y), density: 'compact', covered: false });
    const revealed = composer.revealedExpanded;
    return <main data-reserved={String(composer.reservedExpanded)} data-revealed={String(revealed)}>
      <button onClick={() => composer.setExpanded(true)}>Expand</button></main>;
  }
  const h = await mountDom(<Fixture y={52} />);
  try {
    await h.click(h.document.querySelector('button')!);
    assert.equal(requests.at(-1), true);
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true');
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'false', 'a busy main process must not let the input grow over its old native bounds');
    await h.render(<Fixture y={120} />);
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'true');
  } finally { await h.close(); setShellApi(null); }
});

test('zoomed composer waits for all stacked rows before revealing the field', async () => {
  setShellApi({ setDrawerOpen: () => {}, setComposerExpanded: () => {} } as any);
  function Fixture({ y }: { y: number }) {
    const layout: LayoutState = { mode: 'focus', page: 0, pageCount: 1, focused: 'claude',
      placements: [{ key: 'claude', bounds: { x: 4, y, width: 472, height: 100 } }] };
    const { composer } = useWorkspaceMotion('sites', false, 'pointer', false, { layout, density: 'compact', covered: false });
    return <main data-revealed={String(composer.revealedExpanded)}><button onClick={() => composer.setExpanded(true)}>Expand</button></main>;
  }
  const h = await mountDom(<Fixture y={120} />, window => { window.innerWidth = 480; });
  try {
    await h.click(h.document.querySelector('button')!);
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'false');
    await h.render(<Fixture y={200} />);
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'true');
  } finally { await h.close(); setShellApi(null); }
});
