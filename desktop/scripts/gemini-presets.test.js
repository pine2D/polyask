'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('gemini.google.com', '<button aria-label="Open mode picker, currently Gemini Flash"></button>', ['adapters-intl3', 'gemini-presets']);
  const state = { model: options.initialModel || (options.modern ? '4 Carbon' : '3.8 Flash'), effort: 'Low' }, clicks = [];
  const choices = { '3.8 Flash': ['Low', 'Medium', 'High'], '4 Argon': ['Low', 'High'], 'Future Lite': [] };
  if (options.modern) { delete choices['Future Lite']; choices['3.5 Flash-Lite'] = []; choices['4 Carbon'] = ['Low', 'Medium', 'High']; }
  const descriptions = { '3.8 Flash': 'All-around help', '4 Argon': 'Code & analysis', '4 Carbon': 'Most complex work', 'Future Lite': 'Quick answers' };
  const close = () => f.d.querySelectorAll('[role="menu"]').forEach(el => el.remove());
  const button = f.d.querySelector('button');
  function item(name, kind) {
    const el = f.d.createElement('gem-menu-item'); el.setAttribute('role', 'menuitemradio');
    const flipped = options.modern && kind === 'model';
    el.innerHTML = `<gem-menu-item-content><span class="label"> ${flipped ? descriptions[name] || 'Quick answers' : name} </span><span class="sublabel">${flipped ? name : 'Description with High and other models'}</span></gem-menu-item-content>`;
    el.className = name === state[kind] ? 'selected' : 'active';
    if (options.disabled?.includes(name)) el.setAttribute('aria-disabled', 'true');
    if (kind === 'model') el.setAttribute('data-test-id', `bard-mode-option-${name}`);
    const select = () => { if (!el.isConnected) return; clicks.push(`${kind}:${name}`);
      if (!options.ignore) { state[kind] = name; if (kind === 'model') state.effort = choices[name][0] || null; }
      close(); button.setAttribute('aria-label', `Open mode picker, currently Gemini ${state.model}${state.effort === 'Low' ? '' : ` ${state.effort}`}`);
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
test('Gemini keeps saved modern menu labels compatible when reading and verifying Carbon presets', async () => {
  const f = setup({ modern: true }); try {
    assert.deepEqual(plain((await f.command({ kind: 'current' })).current), { model: 'Most complex work', effort: 'Low' });
    const options = plain(await f.command({ kind: 'options', model: 'Most complex work' }));
    assert.equal(options.ok, true);
    assert.deepEqual(options.catalog.models, ['All-around help', 'Code & analysis', 'Quick answers', 'Most complex work']);
    assert.deepEqual(options.catalog.efforts, ['Low', 'Medium', 'High']);
    const verified = plain(await f.command({ kind: 'verify', preset: { model: 'Most complex work', effort: 'High' } }));
    assert.equal(verified.ok, true);
    assert.deepEqual(verified.verified, { model: 'Most complex work', effort: 'High' });
    assert.deepEqual(f.state, { model: '4 Carbon', effort: 'Low' });
    assert.equal(f.d.querySelector('textarea').value, 'untouched draft');
    assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Gemini recommended tiers select Argon in modern radios and exact presets select Carbon', async () => {
  const f = setup({ modern: true }); try {
    for (const [mode, effort] of [['think', 'High'], ['fast', 'Low']]) {
      const result = plain(await f.S.resolveTier(mode, Date.now() + 10000));
      assert.equal(result.outcome, 'mode_only');
      assert.deepEqual(f.state, { model: '4 Argon', effort });
      assert.equal(f.menus(), 0);
    }
    for (const [mode, effort] of [['think', 'High'], ['fast', 'Low'], ['fast', 'Low'], ['think', 'Medium']]) {
      const result = plain(await f.S.resolveTier(mode, Date.now() + 10000, undefined, { model: 'Most complex work', effort }));
      assert.equal(result.outcome, 'preferred');
      assert.deepEqual(f.state, { model: '4 Carbon', effort });
      assert.equal(f.a.state(), effort === 'High' ? 'think' : null);
      assert.equal(f.menus(), 0);
    }
    assert.equal(f.d.querySelector('textarea').value, 'untouched draft');
  } finally { f.close(); }
});
test('Gemini excludes a disabled Carbon model and cannot validate it or change the current model', async () => {
  const f = setup({ modern: true, initialModel: '4 Argon', disabled: ['4 Carbon'] }); try {
    const result = plain(await f.command({ kind: 'options' }));
    assert.equal(result.ok, true);
    assert.equal(result.catalog.models.includes('Most complex work'), false);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Most complex work', effort: 'High' } })).ok, false);
    assert.deepEqual(f.state, { model: '4 Argon', effort: 'Low' });
    assert.equal(f.clicks.includes('model:4 Carbon'), false);
    assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
