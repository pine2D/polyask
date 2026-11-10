'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('www.kimi.com', '<div class="current-model"><span class="name">K3.1 Pro</span><span class="current-effort">High</span></div>', ['adapters-cn2', 'kimi-presets']);
  const state = { model: 'K3.1 Pro', effort: 'High' }, clicks = [], entry = f.d.querySelector('.current-model');
  const close = () => { f.d.querySelectorAll('.kimi-menu__inner,[role="menu"]').forEach(el => options.leaving ? el.classList.add('kimi-menu-leave-active') : el.remove()); entry.classList.remove('active'); };
  const label = () => { entry.querySelector('.name').textContent = state.model; entry.querySelector('.current-effort').textContent = state.effort || ''; };
  entry.onclick = () => {
    if (entry.classList.contains('active')) { close(); return; } f.d.querySelectorAll('.kimi-menu-leave-active').forEach(el => el.remove()); entry.classList.add('active');
    const root = f.d.createElement('div'); root.className = 'kimi-menu__inner';
    root.innerHTML = '<div class="model-list-options"></div>'; f.d.body.append(root);
    for (const name of ['K3.1 Pro', 'Future model', 'Instant']) {
      const item = f.d.createElement('div'); item.className = `model-item${state.model === name ? ' checked' : ''}`; item.innerHTML = `<span class="name">${name}</span>`;
      item.onclick = () => { clicks.push(`model:${name}`); state.model = name; state.effort = name === 'Instant' ? null : 'High'; label(); close(); if (options.navigate) f.w.history.replaceState({}, '', '/agent'); };
      root.firstChild.append(item);
    }
    if (state.model === 'Instant') return;
    for (const title of ['Thinking effort', 'Context length', 'Speed']) {
      const row = f.d.createElement('div'); row.className = 'effort-item'; row.innerHTML = `<span class="effort-title">${title}</span>`; root.append(row);
      row.id = `row-${title.replaceAll(' ', '-')}`; row.setAttribute('aria-controls', `${row.id}-menu`);
      row.addEventListener('mouseenter', () => {
        if (f.d.getElementById(`${row.id}-menu`)) return;
        const submenu = f.d.createElement('div'); submenu.id = `${row.id}-menu`; submenu.setAttribute('role', 'menu'); submenu.setAttribute('aria-labelledby', row.id); f.d.body.append(submenu);
        for (const name of title === 'Thinking effort' ? ['Standard', 'High', 'Max', 'Future depth'] : ['Trap']) {
          const opt = f.d.createElement('div'); opt.className = `effort-option${name === state.effort ? ' checked' : ''}`; opt.innerHTML = `<span class="effort-name">${name}</span>`;
          opt.onclick = () => { clicks.push(`effort:${name}`); if (!options.ignore) state.effort = name; label(); close(); }; submenu.append(opt);
        }
      });
    }
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return { ...f, state, clicks };
}
test('Kimi enumerates only Thinking effort and restores exact current choice', async () => {
  const f = setup(); try {
    const result = plain(await f.command({ kind: 'options' })); assert.equal(result.ok, true);
    assert.deepEqual(result.catalog.efforts, ['Standard', 'High', 'Max', 'Future depth']);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'K3.1 Pro', effort: 'Future depth' } })).ok, true);
    assert.deepEqual(f.state, { model: 'K3.1 Pro', effort: 'High' }); assert.deepEqual(f.clicks, ['effort:Future depth', 'effort:High']);
  } finally { f.close(); }
});
test('Kimi settings never navigate to probe another model, but actual switching can follow model navigation', async () => {
  const f = setup({ navigate: true }); try {
    for (const action of [{ kind: 'options', model: 'Future model' }, { kind: 'verify', preset: { model: 'Future model', effort: 'Max' } }]) {
      assert.equal((await f.command(action)).code, 'preset_model_switch_required'); assert.equal(f.clicks.length, 0);
    }
    assert.deepEqual(plain(await f.a.applyPreset({ model: 'Future model', effort: 'Max' }, Date.now() + 5000)), { model: 'Future model', effort: 'Max' });
    assert.equal(f.w.location.pathname, '/agent');
  } finally { f.close(); }
});
test('Kimi cannot confirm swallowed effort changes or click after expiry', async () => {
  const f = setup({ ignore: true }); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'K3.1 Pro', effort: 'Max' } })).ok, false);
    const before = f.clicks.length;
    await assert.rejects(f.a.applyPreset({ model: 'K3.1 Pro', effort: 'Max' }, Date.now() - 1), /timeout/);
    assert.equal(f.clicks.length, before);
  } finally { f.close(); }
});

test('Kimi ignores its closing animation nodes after the menu has been dismissed', async () => {
  const f = setup({ leaving: true }); try {
    assert.equal((await f.command({ kind: 'options' })).ok, true);
    assert.equal((await f.command({ kind: 'options' })).ok, true);
    assert.equal(f.d.querySelector('.current-model').classList.contains('active'), false);
  } finally { f.close(); }
});
