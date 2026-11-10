'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('www.doubao.com', '<div id="owned" data-state="closed" data-slot="dropdown-menu-trigger" aria-haspopup="menu"><button data-disabled="false" data-testid="chat_input_action_model"></button></div>', ['adapters-cn', 'doubao-presets']);
  let selected = '快速'; const clicks = [], b = f.d.querySelector('button');
  const close = () => { b.parentElement.removeAttribute('aria-hidden'); if (!options.stuck) f.d.querySelectorAll('[role="menu"]').forEach(el => el.remove()); };
  b.onclick = () => {
    if (f.menus()) { close(); return; }
    if (options.modal) b.parentElement.setAttribute('aria-hidden', 'true');
    const root = f.d.createElement('div'); root.setAttribute('role', 'menu'); root.setAttribute('data-state', 'open'); root.setAttribute('aria-labelledby', 'owned'); f.d.body.append(root);
    f.w.setTimeout(() => {
      for (const name of ['快速', '专家', 'Future mode']) {
        const el = f.d.createElement('div'); el.setAttribute('role', 'menuitem');
        el.innerHTML = `<div><svg></svg><span class="shrink-0">${name}</span><span>description</span></div>${name === selected || options.ambiguous ? '<svg></svg>' : ''}`;
        el.onclick = () => { clicks.push(name); if (!options.ignore) selected = name; close(); }; root.append(el);
      }
    }, options.delay || 0);
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return { ...f, clicks, selected: () => selected };
}
test('Doubao waits for menu contents, uses only owned direct checks and restores future labels', async () => {
  const f = setup({ delay: 50 }); try {
    assert.equal(f.a.currentPreset?.() ?? null, null);
    const result = plain(await f.command({ kind: 'options' })); assert.equal(result.ok, true);
    assert.deepEqual(result.catalog.models, ['快速', '专家', 'Future mode']); assert.equal(result.catalog.primary, 'mode');
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Future mode', effort: null } })).ok, true);
    assert.equal(f.selected(), '快速'); assert.equal(f.menus(), 0); assert.equal(f.a.currentPreset(), null);
    assert.deepEqual(f.clicks, ['Future mode', '快速']);
  } finally { f.close(); }
});
test('Doubao rejects ambiguous checks, missing modes, swallowed clicks and menus that do not close', async () => {
  for (const options of [{ ambiguous: true }, { ignore: true }, { stuck: true }]) {
    const f = setup(options); try {
      assert.equal((await f.command({ kind: 'verify', preset: { model: '专家', effort: null } })).ok, false);
      assert.equal(f.selected(), '快速');
    } finally { f.close(); }
  }
  const f = setup(); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'missing', effort: null } })).ok, false);
    assert.equal(f.clicks.length, 0); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});

test('Doubao can read its owned modal menu while the trigger background is aria-hidden', async () => {
  const f = setup({ modal: true }); try {
    assert.equal((await f.command({ kind: 'options' })).ok, true); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
