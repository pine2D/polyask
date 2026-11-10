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

test('ChatGPT cold-start read waits for a delayed, enabled trigger without touching the draft', async () => {
  const f = chatgpt({ legacy: true }); try {
    const button = f.d.querySelector('button'), draft = f.d.querySelector('textarea').value;
    button.remove(); button.disabled = true;
    f.w.setTimeout(() => f.d.body.prepend(button), 30);
    f.w.setTimeout(() => { button.disabled = false; }, 1550);
    const r = plain(await f.command({ kind: 'current' }));
    assert.equal(r.ok, true); assert.deepEqual(r.current, { model: '6', effort: '6 Medium' });
    assert.equal(f.d.querySelector('textarea').value, draft); assert.equal(f.state.open, false);
    assert.deepEqual(f.clicks, []); assert.deepEqual(f.keys, []);
  } finally { f.close(); }
});
test('ChatGPT pending startup read stops at deadline or navigation without late clicks', async () => {
  for (const navigate of [false, true]) {
    const f = chatgpt({ legacy: true }); try {
      const button = f.d.querySelector('button'); let clicks = 0;
      button.disabled = true; button.addEventListener('click', () => { clicks++; });
      if (navigate) f.w.setTimeout(() => f.w.history.replaceState({}, '', '/other'), 30);
      f.w.setTimeout(() => { button.disabled = false; }, 180);
      await assert.rejects(f.S.readPreset(f.a, Date.now() + (navigate ? 1000 : 120)), { message: navigate ? 'not_ready' : 'timeout' });
      await new Promise(resolve => f.w.setTimeout(resolve, 200));
      assert.equal(clicks, 0); assert.equal(f.state.open, false); assert.deepEqual(f.keys, []);
    } finally { f.close(); }
  }
});
