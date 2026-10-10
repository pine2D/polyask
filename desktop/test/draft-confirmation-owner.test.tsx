import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { useDraftConfirmation } from '../src/renderer/use-draft-confirmation';
import type { DesktopSurface } from '../src/shared/protocol';
import { mountDom } from './ui/dom-harness';

test('a late draft cleanup cannot restore sites over another confirmation or a newer draft dialog', async () => {
  let flow!: ReturnType<typeof useDraftConfirmation>;
  const commands = { current: { 'focus-prompt': () => {} } }, surfaces: DesktopSurface[] = [];
  function Fixture() { flow = useDraftConfirmation(commands); return <span>{String(flow.blocking)}</span>; }
  const h = await mountDom(<Fixture />);
  const changeSurface = (value: DesktopSurface) => { flow.surfaceChanged(value); surfaces.push(value); };
  try {
    const first = Symbol('first'), second = Symbol('second');
    await act(async () => { flow.change(true, first, changeSurface); });
    assert.equal(Object.keys(commands.current).length, 0); assert.equal(flow.blocking, true);
    changeSurface('confirmation');
    await act(async () => { flow.change(false, first, changeSurface); });
    assert.equal(surfaces.join(','), 'confirmation,confirmation', 'another confirmation keeps its native cover');
    await act(async () => { flow.change(true, second, changeSurface); flow.change(false, first, changeSurface); });
    assert.equal(flow.blocking, true); assert.equal(flow.isBlocking(), true);
    await act(async () => { flow.change(false, second, changeSurface); });
    assert.equal(flow.blocking, false); assert.equal(surfaces.at(-1), 'sites');
    await act(async () => { flow.change(true, first, changeSurface); });
    changeSurface('settings');
    await act(async () => { flow.change(false, first, changeSurface); });
    assert.equal(surfaces.at(-1), 'settings', 'cleanup cannot navigate away from an explicit surface change');
  } finally { await h.close(); }
});
