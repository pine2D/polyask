import assert from 'node:assert/strict';
import test from 'node:test';
import { isLocalDataStats } from '../src/shared/local-data';

const stats = () => ({ history: 130, archives: 2, decisions: 3, folders: 4, answers: 9, memberships: 5,
  drafts: 0, reset: { preferences: 0, answers: 11, memberships: 8, templates: 2, groups: 3, workspace: 1 } });

test('active statistics accept safe zero and positive counts with separate reset scope', () => {
  assert.equal(isLocalDataStats(stats()), true);
  assert.equal(isLocalDataStats({ history: 0, archives: 0, decisions: 0, folders: 0, answers: 0, memberships: 0,
    drafts: 0, reset: { preferences: 0, answers: 0, memberships: 0, templates: 0, groups: 0, workspace: 0 } }), true);
});

test('invalid statistics never masquerade as an empty category', () => {
  for (const value of [null, [], {}, { ...stats(), reset: null }, { ...stats(), reset: [] }]) {
    assert.equal(isLocalDataStats(value), false);
  }
  for (const key of ['history', 'archives', 'decisions', 'folders', 'answers', 'memberships']) {
    for (const value of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, '0', undefined]) {
      assert.equal(isLocalDataStats({ ...stats(), [key]: value }), false, `${key}: ${value}`);
    }
  }
  for (const key of ['answers', 'memberships', 'templates', 'groups', 'workspace']) {
    assert.equal(isLocalDataStats({ ...stats(), reset: { ...stats().reset, [key]: -1 } }), false);
  }
  assert.equal(isLocalDataStats({ ...stats(), reset: { ...stats().reset, workspace: 2 } }), false);
});
