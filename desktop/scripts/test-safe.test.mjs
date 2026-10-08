import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTestPlan, linuxBoundary } from './test-safe.mjs';

const root = resolve('synthetic-desktop');

test('Node preload uses a file URL rather than interpreting a Windows drive as an ESM protocol', () => {
  for (const mode of [[], ['unit'], ['runtime'], ['command', 'node', '-e', '']]) {
    for (const step of buildTestPlan(mode, root)) {
      const specifier = step.args[step.args.indexOf('--import') + 1];
      assert.equal(URL.canParse(specifier), true, 'Node preload must use an absolute URL on every platform');
      assert.equal(new URL(specifier).protocol, 'file:');
      assert.equal(fileURLToPath(specifier), resolve(root, 'scripts/lib/assertion-safety.mjs'));
    }
  }
});

test('selected unit tests run only after the DOM assertion check, with preload and one worker', () => {
  const plan = buildTestPlan(['unit', 'test/example.test.tsx'], root);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].args.some(arg => arg.endsWith('check-dom-assertions.mjs')), true);
  assert.equal(plan[1].args.includes('--test-concurrency=1'), true);
  assert.equal(plan[1].args.includes(pathToFileURL(resolve(root, 'scripts/lib/assertion-safety.mjs')).href), true);
  assert.equal(plan[1].args.includes('test/example.test.tsx'), true);
  assert.equal(plan[1].args.includes('tsx'), true);
});

test('full gate keeps typecheck and both test suites; neither suite can omit the guard', () => {
  const plan = buildTestPlan([], root);
  assert.equal(plan.length, 4);
  assert.equal(plan.some(step => step.args.includes('--noEmit')), true);
  const tests = plan.filter(step => step.args.includes('--test'));
  assert.equal(tests.length, 2);
  assert.equal(tests.every(step => step.args.includes('--test-concurrency=1') &&
    step.args.includes(pathToFileURL(resolve(root, 'scripts/lib/assertion-safety.mjs')).href)), true);
});

test('test selectors cannot inject Node flags or silently select no test', () => {
  assert.throws(() => buildTestPlan(['unit', '--test-concurrency=100'], '/project/desktop'), /test file/);
  assert.throws(() => buildTestPlan(['unknown'], '/project/desktop'), /mode/);
});

test('Linux boundary accepts actual bounded cgroup values and rejects unbounded or oversized values', () => {
  assert.equal(linuxBoundary('4294967296', '536870912', '')?.kind, 'cgroup');
  assert.equal(linuxBoundary('max', 'max', ''), null);
  assert.equal(linuxBoundary('8589934592', '536870912', ''), null);
  assert.equal(linuxBoundary('4294967296', 'max', ''), null);
});

test('Linux data limit is distinct from a cgroup and must cover both soft and hard limits', () => {
  const limits = 'Max data size             2147483648           2147483648           bytes';
  assert.equal(linuxBoundary('max', 'max', limits)?.kind, 'rlimit-data');
  assert.equal(linuxBoundary('max', 'max', 'Max data size 2147483648 unlimited bytes'), null);
});
