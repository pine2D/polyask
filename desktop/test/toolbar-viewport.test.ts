import assert from 'node:assert/strict';
import test from 'node:test';
import { viewManagerHarness } from './view-manager-harness';
import { computeWorkspaceLayout } from '../src/main/workspace-layout';

test('native views leave room for the visible toolbar at two hundred percent shell zoom', () => {
  const h = viewManagerHarness();
  h.window.getContentSize = () => [960, 680];
  h.shell.setZoomLevel(Math.log(2) / Math.log(1.2));
  h.manager.relayout();
  assert.equal(h.bounds.at(-1)!.y, 288, '120px toolbar + 24px tile header, scaled by two');
  h.manager.setComposerExpanded(true);
  assert.equal(h.bounds.at(-1)!.y, 448, '200px toolbar + 24px tile header, scaled by two');
});

test('history panel reserves site width without changing the full-width toolbar layout', () => {
  const layout = computeWorkspaceLayout({ width: 800, toolbarWidth: 1280, height: 800, density: 'compact',
    composerExpanded: false, drawerOpen: false, requestedMode: 'focus', focused: 'claude',
    overviewOrder: ['claude'], focusOrder: ['claude'] });
  assert.equal(layout.placements[0].bounds.y, 52);
});

test('stacked toolbar leaves room for page find and feedback in either density', () => {
  for (const [density, want] of [['compact', 168], ['comfortable', 192]] as const) {
    const layout = computeWorkspaceLayout({ width: 480, height: 340, density, composerExpanded: false,
      findOpen: true, drawerOpen: false, requestedMode: 'focus', focused: 'claude',
      overviewOrder: ['claude'], focusOrder: ['claude'] });
    assert.equal(layout.placements[0].bounds.y, want);
    assert.equal(layout.placements[0].bounds.y + layout.placements[0].bounds.height <= 308, true);
  }
});
