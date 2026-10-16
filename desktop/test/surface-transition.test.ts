import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSurfaceChange, type SurfaceTransitionEffects } from '../src/renderer/surface-transition';
import { registerDecisionNavigationGuard, requestDecisionNavigation } from '../src/renderer/decision-navigation';

test('leaving settings delays the entire surface transition and preserves approved navigation depth', () => {
  const calls: string[] = [];
  const effects: SurfaceTransitionEffects = { surfaceChanged: () => { calls.push('surface'); }, closeHistory: () => { calls.push('history'); },
    closeImages: () => { calls.push('images'); }, resetComposer: () => { calls.push('composer'); }, closeDrawer: () => { calls.push('drawer'); },
    commit: () => { requestDecisionNavigation(() => { calls.push('commit'); }); } };
  let pending: (() => void) | null = null, requests = 0;
  const off = registerDecisionNavigationGuard((action, intent) => { requests++; pending = action; assert.equal(intent?.kind, 'surface'); });
  try {
    requestSurfaceChange('settings', 'archive', effects);
    assert.deepEqual(calls, []); assert.equal(requests, 1);
    (pending as unknown as () => void)();
    assert.deepEqual(calls, ['surface', 'history', 'images', 'composer', 'drawer', 'commit']);
    assert.equal(requests, 1);
  } finally { off(); }
});
