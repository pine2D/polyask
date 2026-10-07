import assert, { strictEqual } from 'node:assert/strict';
import legacyAssert from 'node:assert';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import './lib/assertion-safety.mjs';
import { checkDomAssertions } from './lib/dom-assertion-check.mjs';

const require = createRequire(import.meta.url);
const blocked = error => error?.code === 'ERR_UNSAFE_DOM_ASSERTION';
function syntheticNode() {
  let inspections = 0;
  const node = { nodeType: 1, nodeName: 'BUTTON', [inspect.custom]() { inspections++; return '<synthetic button>'; } };
  node.__reactFiber$synthetic = { stateNode: node };
  return { node, inspections: () => inspections };
}

test('DOM comparisons fail before Node inspects a React-owned node', () => {
  const fixture = syntheticNode();
  assert.throws(() => assert.equal(fixture.node, null, 'custom message is insufficient'), blocked);
  assert.equal(fixture.inspections(), 0);
});

test('default, named, CommonJS and legacy assert exports share the guard', () => {
  const { node } = syntheticNode();
  for (const compare of [assert.strictEqual, strictEqual, require('node:assert/strict').equal, legacyAssert.equal]) {
    assert.throws(() => compare(node, node), blocked);
  }
});

test('Assert instances cannot opt into an unguarded full diff', () => {
  const custom = new legacyAssert.Assert({ diff: 'full' });
  const { node } = syntheticNode();
  assert.throws(() => custom.strictEqual(node, null), blocked);
});

test('the actual Node preload blocks unsafe failure without invoking custom inspection', () => {
  const guard = fileURLToPath(new URL('./lib/assertion-safety.mjs', import.meta.url));
  const code = `const assert = require('node:assert/strict');
    const inspect = require('node:util').inspect;
    const node = { nodeType: 1, nodeName: 'BUTTON', [inspect.custom]() { throw Error('INSPECT_CALLED'); } };
    assert.equal(node, null, 'negative assertion');`;
  const result = spawnSync(process.execPath, ['--max-old-space-size=256', '--import', guard, '-e', code],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 16_384 });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes('ERR_UNSAFE_DOM_ASSERTION'), true);
  assert.equal(result.stderr.includes('Error: INSPECT_CALLED'), false);
});

test('unknown getters and traversal beyond the checking budget fail closed', () => {
  let reads = 0;
  const object = { get answer() { reads++; return syntheticNode().node; } };
  assert.throws(() => assert.deepEqual(object, {}), blocked);
  assert.equal(reads, 0);
  assert.throws(() => assert.deepEqual(Array.from({ length: 10_001 }, () => ({})), []), blocked);
});

test('nested DOM values in containers are blocked without following the React tree', () => {
  const { node, inspections } = syntheticNode();
  const actual = { answers: [{ root: node }] };
  actual.self = actual;
  assert.throws(() => assert.deepEqual(actual, {}), blocked);
  assert.throws(() => assert.deepEqual(new Map([['answer', node]]), new Map()), blocked);
  assert.throws(() => assert.deepEqual(new Set([node]), new Set()), blocked);
  assert.equal(inspections(), 0);
});

test('primitive and ordinary data comparisons preserve Node assertion semantics', () => {
  assert.equal(null === null, true);
  assert.equal(undefined === null, false);
  assert.deepEqual({ values: [1, 'a', null] }, { values: [1, 'a', null] });
  assert.notEqual('a', 'b');
  assert.throws(() => assert.equal(false, true, 'ordinary failure'), { code: 'ERR_ASSERTION' });
});

test('native Error stack accessors remain compatible while attached DOM values are blocked', () => {
  const failure = new Error('database_not_ready');
  assert.deepEqual([failure], [failure]);
  assert.equal(failure, failure);
  failure.details = { root: syntheticNode().node };
  assert.throws(() => assert.deepEqual([failure], []), blocked);
});

test('static check catches direct selectors, focus identity and helper aliases', () => {
  const source = `import assert from 'node:assert/strict';
    const button = document.querySelector('button');
    assert.equal(document.querySelector('[name="retry-site"]'), null, 'unsafe');
    assert.strictEqual(document.activeElement, button);
    assert.deepEqual({ root: button }, {});
    assert.equal(h.choice('kimi'), null);`;
  assert.equal(checkDomAssertions(source).length, 4);
});

test('static check allows strict booleans and scalar DOM properties, ignores fixture strings', () => {
  const source = `import assert from 'node:assert/strict';
    const sourceFixture = "assert.equal(document.querySelector('button'), null)";
    assert.equal(document.querySelector('button') === null, true);
    assert.equal(document.activeElement === button, true);
    assert.equal(document.querySelector('button')?.textContent, 'Send');
    assert.equal(document.querySelectorAll('button').length, 2);
    assert.equal(button.disabled, false);`;
  assert.equal(checkDomAssertions(source).length, 0);
});

test('static check handles CommonJS and named assertion imports', () => {
  assert.equal(checkDomAssertions(`const check = require('node:assert/strict');
    check.equal(turn.answer, document.getElementById('answer'));`).length, 1);
  assert.equal(checkDomAssertions(`import { strictEqual as same } from 'node:assert';
    same(document.activeElement, document.querySelector('button'));`).length, 1);
});
