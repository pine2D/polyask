'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('gemini.google.com', '<button aria-label="Open mode picker, currently Gemini Flash"></button>', ['adapters-intl3', 'gemini-presets']);
  const state = { model: '3.8 Flash', effort: 'Low' }, clicks = [], choices = { '3.8 Flash': ['Low', 'Medium', 'High'], '4 Argon': ['Low', 'High'], 'Future Lite': [] };
  const close = () => f.d.querySelectorAll('[role="menu"]').forEach(el => el.remove());
  const button = f.d.querySelector('button');
  function item(name, kind) {
    const el = f.d.createElement('gem-menu-item'); el.setAttribute('role', 'menuitemradio');
    el.innerHTML = `<gem-menu-item-content><span class="label">${name}</span><span class="sublabel">Description with High and other models</span></gem-menu-item-content>`;
    el.className = name === state[kind] ? 'selected' : 'active';
    if (kind === 'model') el.setAttribute('data-test-id', `bard-mode-option-${name}`);
    const select = () => { if (!el.isConnected) return; clicks.push(`${kind}:${name}`);
      if (!options.ignore) { state[kind] = name; if (kind === 'model') state.effort = choices[name][0] || null; }
      close(); button.setAttribute('aria-label', `Open mode picker, currently Gemini ${state.model}`);
    };
    el.onclick = select; el.onkeydown = e => { if (e.key === 'Enter') select(); }; return el;
  }
  button.onclick = () => {
    if (f.menus()) { close(); return; } const root = f.d.createElement('div'); root.setAttribute('role', 'menu'); f.d.body.append(root);
    Object.keys(choices).forEach(name => root.append(item(name, 'model')));
    if (options.duplicate) root.append(item(state.model, 'model'));
    if (choices[state.model].length) {
      const row = f.d.createElement('gem-menu-item'); row.setAttribute('role', 'menuitem'); row.innerHTML = '<span class="label">Thinking level</span>';
      row.onclick = () => { if (row.querySelector('[role="menuitemradio"]')) return; choices[state.model].forEach(name => row.append(item(name, 'effort'))); }; root.append(row);
    }
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return { ...f, state, clicks };
}
test('Gemini modern radios read pure labels and fresh Low evidence hidden by the closed button', async () => {
  const f = setup(); try {
    assert.equal(f.a.currentPreset?.() ?? null, null);
    const result = plain(await f.command({ kind: 'options', model: '4 Argon' })); assert.equal(result.ok, true);
    assert.deepEqual(result.catalog.models, ['3.8 Flash', '4 Argon', 'Future Lite']); assert.deepEqual(result.catalog.efforts, ['Low', 'High']);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' });
    assert.equal((await f.command({ kind: 'verify', preset: { model: '4 Argon', effort: 'High' } })).ok, true);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' }); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Gemini distinguishes an actual no-level model from unsupported combinations', async () => {
  const f = setup(); try {
    assert.deepEqual(plain((await f.command({ kind: 'options', model: 'Future Lite' })).catalog.efforts), []);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future Lite', effort: null } })).ok, true);
    assert.equal((await f.command({ kind: 'verify', preset: { model: '4 Argon', effort: null } })).ok, false);
    assert.deepEqual(f.state, { model: '3.8 Flash', effort: 'Low' });
  } finally { f.close(); }
});
test('Gemini rejects duplicate model labels and does not confirm an ignored effort click', async () => {
  for (const options of [{ duplicate: true }, { ignore: true }]) {
    const f = setup(options); try { assert.equal((await f.command({ kind: 'verify', preset: { model: '3.8 Flash', effort: 'High' } })).ok, false); }
    finally { f.close(); }
  }
});
