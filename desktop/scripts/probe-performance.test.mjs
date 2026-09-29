import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { measureSiteProbe, mainFrameProbeContext } from './lib/measure-site-probe.mjs';

function probe(adapter, toMarkdown = () => 'PRIVATE') {
  let now = 0;
  return JSON.parse(JSON.stringify(runInNewContext(`(${measureSiteProbe.toString()})()`, {
    window: { __AMS: { pickAdapter: () => adapter, toMarkdown } },
    performance: { now: () => ++now }, innerWidth: 600, innerHeight: 800
  })));
}
test('probe measures production read-only hooks without returning content or calling actions', () => {
  const result = probe({ generation: () => 'generating', answer: () => ({ text: 'PRIVATE' }),
    think() { assert.fail('must not switch models'); }, submit() { assert.fail('must not send'); } });
  assert.deepEqual(result, { available: true, viewport: { width: 600, height: 800 },
    generation: { ms: 1, failed: false, state: 'generating' },
    answer: { ms: 1, failed: false, present: true }, markdown: { ms: 1, failed: false, present: true } });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('missing answer is not reported as a successful serialization measurement', () => {
  const result = probe({ answer: () => null }, () => assert.fail('no node'));
  assert.equal(result.markdown, null);
  assert.equal(result.generation, null);
  assert.equal(result.answer.present, false);
  assert.deepEqual(probe(null), { available: false });
});
test('probe sanitizes exceptions and unexpected states', () => {
  const result = probe({ generation: () => 'PRIVATE', answer: () => { throw new Error('PRIVATE'); } });
  assert.equal(result.generation.state, null);
  assert.equal(result.answer.failed, true);
  assert.equal(result.markdown, null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('probe selects only the main frame isolated context, never a same-process iframe', () => {
  const child = { id: 1, name: 'Electron Isolated Context', auxData: { isDefault: false, frameId: 'child' } };
  const main = { id: 2, name: 'Electron Isolated Context', auxData: { isDefault: false, frameId: 'main' } };
  assert.equal(mainFrameProbeContext([child, main], 'main'), main);
  assert.equal(mainFrameProbeContext([child], 'main'), undefined);
  assert.equal(mainFrameProbeContext([main], undefined), undefined);
});
