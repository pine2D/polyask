import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionSiteSurface } from '../src/main/site-surface';
import { coverSitesForHistory } from '../src/main/question-layout';

function fixture() {
  let detached = 0, restored = 0;
  const view = { webContents: {}, visible: true, bounds: { width: 380, height: 500 },
    setVisible(visible: boolean) { this.visible = visible; } };
  const window = { webContents: {}, contentView: { children: [view] } };
  return { view, get detached() { return detached; }, get restored() { return restored; }, effects: {
    detach: () => { detached++; window.contentView.children = []; view.bounds = { width: 0, height: 0 }; },
    cover: (covered: boolean) => coverSitesForHistory(window as never, covered),
    restore: () => { restored++; window.contentView.children = [view]; view.visible = true; view.bounds = { width: 380, height: 500 }; }
  } };
}

test('retry confirmation hides attached sites without removing their positive viewports', () => {
  const h = fixture();
  transitionSiteSurface('sites', 'confirmation', h.effects);
  assert.equal(h.detached, 0, 'confirmation must preserve generation and capture viewports');
  assert.equal(h.view.visible, false);
  assert.deepEqual(h.view.bounds, { width: 380, height: 500 });
  transitionSiteSurface('confirmation', 'sites', h.effects);
  assert.equal(h.restored, 1); assert.equal(h.view.visible, true);
});

test('history and confirmation share covered views; leaving either for a workspace detaches them', () => {
  const h = fixture();
  transitionSiteSurface('sites', 'question-history', h.effects);
  transitionSiteSurface('question-history', 'confirmation', h.effects);
  assert.equal(h.detached, 0);
  assert.equal(h.view.visible, false);
  transitionSiteSurface('confirmation', 'archive', h.effects);
  assert.equal(h.detached, 1);
});

test('ordinary workspace transitions still detach and unchanged surfaces do no work', () => {
  for (const next of ['settings', 'commands', 'archive'] as const) {
    const h = fixture(); transitionSiteSurface('sites', next, h.effects);
    assert.equal(h.detached, 1); assert.equal(h.restored, 0);
    transitionSiteSurface(next, next, h.effects);
    assert.equal(h.detached, 1);
  }
});
