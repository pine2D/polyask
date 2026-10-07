import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteKey } from '../src/shared/contracts';
import type { SiteStatus } from '../src/shared/protocol';
import { reclaimUnselectedViews } from '../src/main/view-reclamation';

function fixture(phase: SiteStatus['phase'], navigating = false, capturePending = false, observationEnded = false) {
  const closed: SiteKey[] = [], detached: SiteKey[] = [], forgotten: SiteKey[] = [];
  const views = new Map<any, any>([['kimi', { webContents: { isDestroyed: () => false, close: () => closed.push('kimi') } }]]);
  const status: SiteStatus = { site: 'kimi', phase };
  const options = {
    views, selected: [] as SiteKey[], status: () => status,
    navigating: () => navigating, capturePending: () => capturePending,
    observationEnded: () => observationEnded,
    detach: (site: SiteKey) => detached.push(site),
    pageStatus: new Map([['kimi' as SiteKey, status]]), runStatus: new Map([['kimi' as SiteKey, status]]),
    forget: (site: SiteKey) => forgotten.push(site)
  };
  return { options, closed, detached, forgotten, views };
}

test('page reclamation preserves a view while its navigation is in progress', () => {
  const h = fixture('ready', true);
  reclaimUnselectedViews(h.options);
  assert.deepEqual(h.closed, [], 'a close decision must not outrun an in-flight page navigation');
  assert.deepEqual(h.detached, []);
  assert.deepEqual(h.forgotten, []);
  assert.equal(h.views.size, 1);
});

test('capture and uncertain generation stay protected independently of the visible page phase', () => {
  for (const [phase, capture, ended] of [
    ['complete', true, true], ['ready', true, false], ['sending', false, true],
    ['submitted', false, false], ['generating', false, false], ['warning', false, false]
  ] as const) {
    const h = fixture(phase, false, capture, ended);
    reclaimUnselectedViews(h.options);
    assert.equal(h.closed.length, 0, `${phase}: capture/submit uncertainty cannot release the view`);
    assert.equal(h.detached.length, 0);
    assert.equal(h.views.size, 1);
  }
});

test('an idle unselected page releases exactly once after all protection conditions clear', () => {
  const h = fixture('complete', false, false, true);
  reclaimUnselectedViews(h.options);
  reclaimUnselectedViews(h.options);
  assert.deepEqual(h.closed, ['kimi']);
  assert.deepEqual(h.detached, ['kimi']);
  assert.deepEqual(h.forgotten, ['kimi']);
  assert.equal(h.views.size, 0);
  assert.equal(h.options.pageStatus.size, 0);
  assert.equal(h.options.runStatus.size, 0);
});
