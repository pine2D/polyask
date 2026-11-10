'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('yuanbao.tencent.com', '<button id="trigger" aria-label="Switch model">Instant</button>', ['adapters-cn3', 'yuanbao-presets']);
  const state = { model: 'Hy3', effort: 'Instant' }, clicks = [], button = f.d.querySelector('button');
  const choices = { Hy3: ['Instant', 'Thinking', 'Expert'], Hy4: ['Expert'], 'Future model': ['Instant', 'Thinking'] };
  let rootReady = true;
  const close = () => { button.setAttribute('aria-expanded', 'false'); if (!options.lingering) f.d.querySelectorAll('[role="menu"]').forEach(el => el.remove()); };
  function item(name, kind) {
    const el = f.d.createElement('div'); el.setAttribute('role', 'menuitemradio'); el.setAttribute('aria-checked', String(state[kind] === name));
    el.innerHTML = `<span><span>${name}<span class="badge">New</span></span><span>Thinking model description</span></span>`;
    el.onclick = () => { clicks.push(`${kind}:${name}`); if (!options.ignore) { state[kind] = name; if (kind === 'model') state.effort = choices[name][0]; }
      button.textContent = state.effort; close(); }; return el;
  }
  button.onclick = () => {
    if (button.getAttribute('aria-expanded') === 'true') { close(); return; }
    f.d.querySelectorAll('[role="menu"]').forEach(el => el.remove()); button.setAttribute('aria-expanded', 'true'); const root = f.d.createElement('div'); root.setAttribute('role', 'menu'); root.setAttribute('aria-labelledby', 'trigger');
    const row = f.d.createElement('div'); row.setAttribute('role', 'menuitem'); row.textContent = `Models${state.model}`; row.id = 'models'; root.append(row);
    row.addEventListener('mousemove', () => {
      if (f.d.querySelector('[aria-label="Model list"]')) return; const sub = f.d.createElement('div'); sub.setAttribute('role', 'menu'); sub.setAttribute('aria-label', 'Model list'); sub.setAttribute('aria-labelledby', 'models');
      Object.keys(choices).forEach(name => sub.append(item(name, 'model'))); f.d.body.append(sub);
    });
    choices[state.model].forEach(name => root.append(item(name, 'effort'))); f.d.body.append(root);
  };
  f.d.body.addEventListener('keydown', e => { if (e.key !== 'Escape') return;
    const sub = f.d.querySelector('[aria-label="Model list"]');
    if (options.layered && sub) { sub.remove(); rootReady = false; f.w.setTimeout(() => { rootReady = true; }, 30); return; }
    if (rootReady) close();
  });
  return { ...f, state, clicks };
}
test('Yuanbao scopes model and mode radios separately and refreshes modes after changing models', async () => {
  const f = setup(); try {
    const r = plain(await f.command({ kind: 'options', model: 'Hy4' })); assert.equal(r.ok, true);
    assert.deepEqual(r.catalog.models, ['Hy3', 'Hy4', 'Future model']); assert.deepEqual(r.catalog.efforts, ['Expert']);
    assert.equal(r.catalog.secondary, 'mode'); assert.deepEqual(f.state, { model: 'Hy3', effort: 'Instant' });
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future model', effort: 'Thinking' } })).ok, true);
    assert.deepEqual(f.state, { model: 'Hy3', effort: 'Instant' }); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Yuanbao never substitutes another mode and detects ignored selection', async () => {
  for (const options of [{}, { ignore: true }]) {
    const f = setup(options); try {
      assert.equal((await f.command({ kind: 'verify', preset: { model: 'Hy4', effort: options.ignore ? 'Expert' : 'Instant' } })).ok, false);
      assert.deepEqual(f.state, { model: 'Hy3', effort: 'Instant' }); assert.equal(f.menus(), 0);
    } finally { f.close(); }
  }
});

test('Yuanbao restores across models when closed menus still have geometry', async () => {
  const f = setup({ lingering: true }); try {
    assert.equal((await f.command({ kind: 'options', model: 'Hy4' })).ok, true);
    assert.deepEqual(f.state, { model: 'Hy3', effort: 'Instant' });
    assert.equal(f.d.getElementById('trigger').getAttribute('aria-expanded'), 'false');
  } finally { f.close(); }
});

test('Yuanbao dismisses the submenu before closing its newly active parent', async () => {
  const f = setup({ layered: true }); try {
    assert.equal((await f.command({ kind: 'options', model: 'Hy4' })).ok, true);
    assert.deepEqual(f.state, { model: 'Hy3', effort: 'Instant' }); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
