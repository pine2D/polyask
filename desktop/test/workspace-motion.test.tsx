import assert from 'node:assert/strict';
import test from 'node:test';
import { useWorkspaceMotion } from '../src/renderer/use-workspace-motion';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import type { LayoutState } from '../src/shared/protocol';

test('composer locks both expand and collapse to native WebContentsView geometry updates with zero split frames', async () => {
  const requests: boolean[] = [];
  setShellApi({ setDrawerOpen: () => {}, setComposerExpanded: (value: boolean) => { requests.push(value); } } as any);
  const layout = (y: number): LayoutState => ({ mode: 'overview', page: 0, pageCount: 1, focused: 'claude',
    placements: [{ key: 'claude', bounds: { x: 6, y, width: 800, height: 400 } }] });
  function Fixture({ y }: { y: number }) {
    const { composer } = useWorkspaceMotion('sites', false, 'pointer', false, { layout: layout(y), density: 'compact', covered: false });
    return <main data-expanded={String(composer.expanded)} data-reserved={String(composer.reservedExpanded)} data-revealed={String(composer.revealedExpanded)}>
      <button name="expand" onClick={() => composer.setExpanded(true)}>Expand</button>
      <button name="collapse" onClick={() => composer.setExpanded(false)}>Collapse</button></main>;
  }
  // 22px Platinum titlebar + 44px compact toolbar = 66px collapsed; + 48px Ctrl+F find bar = 114px (still < 134px expanded!).
  const h = await mountDom(<Fixture y={114} />);
  try {
    await h.click(h.document.querySelector('button[name="expand"]')!);
    assert.equal(requests.at(-1), true, 'IPC expand fires immediately in 0ms');
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'false', 'collapsed + find-bar y=114 does not falsely pass 22+112=134 gate');
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'false', 'a busy main process must not let the input grow over its old native bounds');
    await h.render(<Fixture y={134} />);
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true');
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'true');

    // Collapse: IPC fires immediately, while DOM holds flush with y=134 until native views move up to y=66.
    await h.click(h.document.querySelector('button[name="collapse"]')!);
    assert.equal(requests.at(-1), false, 'IPC collapse fires immediately without a 140ms delay');
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'true', 'toolbar holds flush with native panes until layout commits');
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'true');
    await h.render(<Fixture y={66} />);
    assert.equal(h.document.querySelector('main')!.dataset.reserved, 'false', 'toolbar and native panes snap together on the same frame');
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'false');
  } finally { await h.close(); setShellApi(null); }
});

test('zoomed composer waits for all stacked rows including 22px titlebar before revealing the field', async () => {
  setShellApi({ setDrawerOpen: () => {}, setComposerExpanded: () => {} } as any);
  function Fixture({ y }: { y: number }) {
    const layout: LayoutState = { mode: 'focus', page: 0, pageCount: 1, focused: 'claude',
      placements: [{ key: 'claude', bounds: { x: 6, y, width: 472, height: 100 } }] };
    const { composer } = useWorkspaceMotion('sites', false, 'pointer', false, { layout, density: 'compact', covered: false });
    return <main data-revealed={String(composer.revealedExpanded)}><button onClick={() => composer.setExpanded(true)}>Expand</button></main>;
  }
  const h = await mountDom(<Fixture y={174} />, window => { window.innerWidth = 480; });
  try {
    await h.click(h.document.querySelector('button')!);
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'false', 'stacked collapsed + find bar (22+104+48=174) waits for 22+176=198');
    await h.render(<Fixture y={198} />);
    assert.equal(h.document.querySelector('main')!.dataset.revealed, 'true');
  } finally { await h.close(); setShellApi(null); }
});
