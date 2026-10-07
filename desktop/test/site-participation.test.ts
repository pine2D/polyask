import assert from 'node:assert/strict';
import test from 'node:test';
import { isPageReorder, pagesNeededForParticipation, reconcileParticipation } from '../src/renderer/site-participation';

test('exclusion preserves open pages and group selection only appends missing pages', () => {
  assert.deepEqual(reconcileParticipation(['claude', 'kimi'], ['kimi']), {
    opened: ['claude', 'kimi'], participating: ['kimi'], excluded: ['claude']
  });
  assert.deepEqual(pagesNeededForParticipation(['claude', 'kimi'], ['gemini', 'kimi']), ['claude', 'kimi', 'gemini']);
  assert.deepEqual(reconcileParticipation(['claude', 'kimi'], []), {
    opened: ['claude', 'kimi'], participating: [], excluded: ['claude', 'kimi']
  });
});

test('participation keeps group request order while page reordering requires a complete permutation', () => {
  assert.deepEqual(reconcileParticipation(['claude', 'kimi', 'gemini'], ['gemini', 'claude']).participating, ['gemini', 'claude']);
  assert.equal(isPageReorder(['claude', 'kimi'], ['kimi', 'claude']), true);
  assert.equal(isPageReorder(['claude', 'kimi'], ['claude']), false);
  assert.equal(isPageReorder(['claude'], ['kimi']), false);
});

test('unknown or duplicate sites fail closed instead of increasing broadcast membership', () => {
  assert.throws(() => reconcileParticipation(['claude'], ['unknown' as any]), /invalid_site_selection/);
  assert.throws(() => pagesNeededForParticipation(['claude'], ['kimi', 'kimi']), /invalid_site_selection/);
  assert.throws(() => isPageReorder(['claude'], ['claude', 'claude']), /invalid_site_selection/);
});
