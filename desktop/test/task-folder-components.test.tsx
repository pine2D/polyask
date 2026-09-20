import assert from 'node:assert/strict';
import test from 'node:test';
import { membershipChanges } from '../src/renderer/folder-membership-dialog';

test('membership edits submit only actual changes, preserving unrelated remote associations', () => {
  assert.deepEqual(membershipChanges(['a'], ['a', 'b']), [{ folderId: 'b', present: true }]);
  assert.deepEqual(membershipChanges(['a', 'b'], ['b']), [{ folderId: 'a', present: false }]);
  assert.deepEqual(membershipChanges(['a'], ['a']), []);
});

test('membership diff treats redundant checks as a set and can remove every old association', () => {
  assert.deepEqual(membershipChanges(['a'], ['a', 'b', 'b']), [{ folderId: 'b', present: true }]);
  assert.deepEqual(membershipChanges(['a', 'b'], []), [{ folderId: 'a', present: false }, { folderId: 'b', present: false }]);
});
