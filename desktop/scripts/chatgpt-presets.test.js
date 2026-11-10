'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { plain } = require('./lib/site-preset-harness');
const { chatgpt } = require('./lib/chatgpt-presets-harness');
test('ChatGPT Default discovers actual joint labels, not a fabricated model-effort product', async () => {
  const f = chatgpt(); try {
    const r = plain(await f.command({ kind: 'options' })); assert.equal(r.ok, true);
    assert.equal(r.catalog.model, 'Default'); assert.deepEqual(r.catalog.efforts, f.choices.Default);
    assert.equal(f.state.model, 'Default'); assert.equal(f.state.index, 1);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Default', effort: 'GPT-6 Astra Extra High' } })).ok, true);
    assert.equal(f.state.model, 'Default'); assert.equal(f.state.index, 1); assert.equal(f.state.open, false);
  } finally { f.close(); }
});
test('ChatGPT legacy and future models use their own actual slider range and labels', async () => {
  const f = chatgpt({ legacy: true }); try {
    const r = plain(await f.command({ kind: 'options', model: 'Future 8' })); assert.equal(r.ok, true);
    assert.deepEqual(r.catalog.efforts, ['Future Light', 'Future Deep']);
    assert.equal(f.state.model, '6'); assert.equal(f.state.index, 1);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future 8', effort: '6 High' } })).ok, false);
    assert.equal(f.state.model, '6'); assert.equal(f.state.index, 1);
  } finally { f.close(); }
});
test('ChatGPT refuses wrong ownership, swallowed keys, and navigation during traversal', async () => {
  for (const options of [{ wrongOwner: true }, { ignoreKeys: true }, { afterKey: (_state, f) => f.w.history.replaceState({}, '', '/other') }]) {
    const f = chatgpt(options); try { assert.equal((await f.command({ kind: 'options' })).ok, false); assert.equal(f.state.open, false); }
    finally { f.close(); }
  }
});
