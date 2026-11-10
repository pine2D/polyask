'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('chatglm.cn', '<button class="think-mode-trigger">GLM-5.3-Flash极致</button>', ['adapters-cn2', 'chatglm-presets']);
  const state = { model: 'GLM-5.3-Flash', effort: '极致' }, clicks = [], button = f.d.querySelector('button');
  const choices = { 'GLM-5.3-Flash': ['快速', '深度', '极致'], 'Future GLM': ['均衡', '深度'] };
  const close = () => { const root = f.d.querySelector('.think-mode-list'); if (options.leaving) root?.setAttribute('aria-hidden', 'true'); else root?.remove(); };
  function entry(name, kind) {
    const el = f.d.createElement('div'); el.className = `think-mode-item${state[kind] === name ? ' selected' : ''}`; el.innerHTML = `<span class="item-name">${name}</span><span>description</span>`;
    el.onclick = () => { clicks.push(`${kind}:${name}`); if (!options.ignore) { state[kind] = name; if (kind === 'model') state.effort = choices[name][0]; }
      close(); button.textContent = state.model + state.effort; }; return el;
  }
  button.onclick = () => {
    const existing = f.d.querySelector('.think-mode-list');
    if (existing && existing.getAttribute('aria-hidden') !== 'true') { close(); return; } existing?.remove();
    const root = f.d.createElement('div'); root.className = 'think-mode-list'; Object.keys(choices).forEach(name => root.append(entry(name, 'model')));
    const row = f.d.createElement('div'); row.className = 'think-mode-item has-submenu'; row.innerHTML = `<span class="item-think">思考强度</span><span class="item-name-container"><span class="item-name">${state.effort}</span></span><div class="think-submenu" data-css-hidden></div>`;
    choices[state.model].forEach(name => row.lastChild.append(entry(name, 'effort'))); root.append(row); f.d.body.append(root);
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return { ...f, state, clicks };
}
test('Chatglm keeps model and CSS-owned effort selections separate', async () => {
  const f = setup(); try {
    const r = plain(await f.command({ kind: 'options', model: 'Future GLM' })); assert.equal(r.ok, true);
    assert.deepEqual(r.catalog.models, ['GLM-5.3-Flash', 'Future GLM']); assert.deepEqual(r.catalog.efforts, ['均衡', '深度']);
    assert.deepEqual(f.state, { model: 'GLM-5.3-Flash', effort: '极致' });
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future GLM', effort: '深度' } })).ok, true);
    assert.deepEqual(f.state, { model: 'GLM-5.3-Flash', effort: '极致' }); assert.equal(f.d.querySelector('.think-mode-list') === null, true);
  } finally { f.close(); }
});
test('Chatglm rejects unlisted efforts and swallowed clicks while preserving the original choice', async () => {
  for (const options of [{}, { ignore: true }]) {
    const f = setup(options); try {
      assert.equal((await f.command({ kind: 'verify', preset: { model: 'GLM-5.3-Flash', effort: options.ignore ? '深度' : 'unlisted' } })).ok, false);
      assert.deepEqual(f.state, { model: 'GLM-5.3-Flash', effort: '极致' });
    } finally { f.close(); }
  }
});

test('Chatglm does not reopen a logically closed menu whose animation keeps its geometry', async () => {
  const f = setup({ leaving: true }); try {
    assert.equal((await f.command({ kind: 'current' })).ok, true);
    assert.equal(f.d.querySelector('.think-mode-list')?.getAttribute('aria-hidden'), 'true');
  } finally { f.close(); }
});
