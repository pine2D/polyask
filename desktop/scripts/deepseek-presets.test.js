'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('chat.deepseek.com', '<button class="ds-toggle-button" aria-pressed="false">DeepThink</button>' +
    '<button class="ds-toggle-button" aria-pressed="true">Search</button>' + (options.radio ?
      '<div role="radiogroup"><div role="radio" aria-checked="true">Instant</div><div role="radio" aria-checked="false">Vision</div></div>' : ''),
  ['adapters-cn', 'deepseek-presets']);
  const clicks = [];
  f.d.querySelectorAll('.ds-toggle-button').forEach(el => el.onclick = () => {
    clicks.push(el.textContent); if (!options.ignore) el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
  });
  f.d.querySelectorAll('[role="radio"]').forEach(el => el.onclick = () => {
    clicks.push(el.textContent); f.d.querySelectorAll('[role="radio"]').forEach(x => x.setAttribute('aria-checked', String(x === el)));
  });
  return { ...f, clicks };
}
test('DeepSeek discovers actual feature/toggle, verifies and restores without touching Search', async () => {
  const f = setup(); try {
    const result = plain(await f.command({ kind: 'options' }));
    assert.equal(result.ok, true); assert.equal(result.catalog.primary, 'feature');
    assert.deepEqual(result.catalog.efforts, ['Off', 'On']);
    assert.deepEqual(plain(await f.command({ kind: 'verify', preset: { model: 'DeepThink', effort: 'On' } })),
      { ok: true, current: { model: 'DeepThink', effort: 'Off' }, verified: { model: 'DeepThink', effort: 'On' } });
    assert.deepEqual(f.clicks, ['DeepThink', 'DeepThink']); assert.equal(f.d.querySelectorAll('button')[1].getAttribute('aria-pressed'), 'true');
  } finally { f.close(); }
});
test('DeepSeek rejects missing boolean evidence, unknown labels and swallowed toggles', async () => {
  const f = setup({ ignore: true }); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'DeepThink', effort: 'On' } })).ok, false);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'DeepSeek future', effort: 'On' } })).ok, false);
    f.d.querySelector('button').removeAttribute('aria-pressed'); assert.equal((await f.command({ kind: 'current' })).ok, false);
  } finally { f.close(); }
});
test('DeepSeek legacy radio is an exact dimension and images never silently substitute Vision', async () => {
  const f = setup({ radio: true }); try {
    assert.deepEqual(plain(f.a.currentPreset()), { model: 'Instant', effort: 'Off' });
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Vision', effort: 'On' } })).ok, true);
    assert.equal(f.a.currentPreset().model, 'Instant'); const before = f.clicks.length;
    await assert.rejects(f.a.applyPreset({ model: 'Instant', effort: 'On' }, Date.now() + 1000, true), /preset_unavailable/);
    assert.equal(f.clicks.length, before);
    await assert.rejects(f.a.applyPreset({ model: 'Vision', effort: 'On' }, Date.now() - 1), /timeout/);
    assert.equal(f.clicks.length, before);
  } finally { f.close(); }
});
