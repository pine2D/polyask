import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePanelFocus } from '../src/main/native-panel-focus';

function harness() {
  let focused: number | null = 7, visible = true;
  const events: string[] = [];
  const focus = new NativePanelFocus({ capture: () => focused === 7 ? 7 : null,
    activate: () => { focused = 1; events.push('shell'); },
    restore: id => { if (focused !== 1 || !visible || id !== 7) return false; focused = id; events.push('site'); return true; }
  });
  return { focus, events, current: () => focused, move: (id: number | null) => { focused = id; }, hide: () => { visible = false; } };
}

test('capture precedes native view removal; accepted panel entry activates shell and close returns to site', async () => {
  const h = harness();
  h.focus.change('surface', 'settings', () => { h.move(null); h.events.push('detach'); });
  assert.equal(h.current(), 1); assert.equal(h.events.join(','), 'detach,shell');
  h.focus.change('surface', false, () => {});
  assert.equal(await h.focus.restore(), true); assert.equal(h.current(), 7);
  assert.equal(await h.focus.restore(), false, 'a return target is consumed once');
});

test('return waits for history and drawer exit reservations without losing the original source', async () => {
  const h = harness(); h.focus.change('drawer', true, () => {}); h.focus.change('history', true, () => {});
  let settled = false; const returned = h.focus.restore().then(value => { settled = true; return value; });
  h.focus.change('history', false, () => {}); await Promise.resolve(); assert.equal(settled, false);
  h.focus.change('drawer', false, () => {});
  assert.equal(await returned, true); assert.equal(h.current(), 7);
});

test('opening a new panel cancels a pending return and retains focus in the new panel', async () => {
  const h = harness(); h.focus.change('drawer', true, () => {});
  const returned = h.focus.restore(); h.focus.change('surface', 'settings', () => {});
  assert.equal(await returned, false); h.focus.change('drawer', false, () => {}); assert.equal(h.current(), 1);
  h.focus.change('surface', false, () => {}); assert.equal(await h.focus.restore(), true);
});

test('hidden sources, explicit focus changes and cancellation do not steal focus', async () => {
  for (const mode of ['hidden', 'moved', 'cancelled']) {
    const h = harness(); h.focus.change('surface', 'archive', () => {});
    if (mode === 'hidden') h.hide();
    if (mode === 'moved') h.move(9);
    if (mode === 'cancelled') h.focus.cancel();
    h.focus.change('surface', false, () => {});
    assert.equal(await h.focus.restore(), false); assert.equal(h.events.includes('site'), false);
  }
});

test('opening from shell has no native source and unchanged reservations do not refocus', async () => {
  const h = harness(); h.move(1); h.focus.change('surface', 'settings', () => {});
  h.focus.change('surface', 'settings', () => {}); assert.equal(h.events.join(','), 'shell');
  h.focus.change('surface', false, () => {}); assert.equal(await h.focus.restore(), false);
});

test('history can exchange its sidebar reservation for a full surface without losing its original site', async () => {
  const h = harness(); h.focus.change('history', true, () => {});
  h.focus.change('history', false, () => {}); h.focus.change('surface', 'question-history', () => {});
  h.focus.change('surface', false, () => {});
  assert.equal(await h.focus.restore(), true); assert.equal(h.current(), 7);
});

test('input during an exit cancels its pending focus return', async () => {
  const h = harness(); h.focus.change('drawer', true, () => {}); const returned = h.focus.restore();
  h.focus.cancelPending(); h.focus.change('drawer', false, () => {});
  assert.equal(await returned, false); assert.equal(h.current(), 1);
});
