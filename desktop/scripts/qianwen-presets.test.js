'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { page, plain } = require('./lib/site-preset-harness');
function setup(options = {}) {
  const f = page('www.qianwen.com', '<div role="tab" aria-selected="true">日常</div><button id="mode" aria-haspopup="menu" aria-label="快速">快速</button>' +
    (options.models ? '<div class="desktop-no-drag"><button id="models" aria-haspopup="dialog" aria-controls="model-dialog"><span>Qwen3.7-千问</span></button></div>' : ''), ['adapters-cn4', 'qianwen-presets']);
  const layout = f.d.createElement('div'); layout.setAttribute('data-chat-input-layout', 'true'); f.d.body.append(layout);
  layout.append(f.d.getElementById('mode'), f.d.querySelector('textarea'));
  layout.insertAdjacentHTML('beforeend', '<button aria-haspopup="menu" aria-label="添加附件"></button><button aria-haspopup="menu" aria-label="更多" data-capsule-layout="follow-parent">更多</button>');
  let model = 'Qwen3.7-千问', mode = '快速', readyAt = 0; const clicks = [], modeToggles = [], modeButton = f.d.getElementById('mode'), modelButton = f.d.getElementById('models');
  const close = () => { f.d.querySelectorAll('[role="menu"],[role="dialog"]').forEach(el => { if (options.keepClosed && el.getAttribute('role') === 'dialog') el.setAttribute('data-state', 'closed'); else el.remove(); }); modeButton.setAttribute('aria-expanded', 'false'); };
  function openMode() {
    if (f.menus()) { if (options.noEscape) close(); return; } modeButton.setAttribute('aria-expanded', 'true'); readyAt = options.transition ? Date.now() + 250 : 0; const menu = f.d.createElement('div'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-labelledby', 'mode');
    for (const name of model === 'Qwen9 Preview' ? ['快速'] : ['快速', '思考研究', ...(options.future ? ['未来模式'] : [])]) {
      const el = f.d.createElement('div'); el.setAttribute('role', 'menuitemcheckbox'); el.setAttribute('aria-checked', String(name === mode)); el.innerHTML = `<div><span>${name}</span><span>description</span></div>`;
      el.onclick = () => { if (Date.now() < readyAt) return; clicks.push(`mode:${name}`); if (!options.ignore) mode = name; modeButton.textContent = mode; modeButton.setAttribute('aria-label', mode); close(); }; menu.append(el);
    }
    f.d.body.append(menu);
  }
  modeButton.addEventListener('pointerdown', () => { modeToggles.push(true); openMode(); }); modeButton.onclick = openMode;
  if (modelButton) modelButton.onclick = () => {
    f.d.querySelectorAll('[role="dialog"][data-state="closed"]').forEach(el => el.remove());
    const dialog = f.d.createElement('div'); dialog.setAttribute('data-state', 'open'); dialog.id = 'model-dialog'; dialog.setAttribute('role', 'dialog');
    for (const name of ['Qwen3.7-千问', 'Qwen9 Preview']) {
      const el = f.d.createElement('div'); el.className = 'group cursor-pointer'; el.innerHTML = `<div class="truncate">${name}</div><div>description</div><button>设为默认</button>`;
      el.onclick = () => { clicks.push(`model:${name}`); model = name; mode = '快速'; modelButton.firstChild.textContent = name; modeButton.textContent = mode; modeButton.setAttribute('aria-label', mode); close(); };
      el.querySelector('button').onclick = event => { event.stopPropagation(); clicks.push('default-trap'); }; dialog.append(el);
    }
    f.d.body.append(dialog);
  };
  f.d.body.addEventListener('keydown', e => { if (e.key === 'Escape' && !options.noEscape && Date.now() >= readyAt) { if (options.asyncClose) f.w.setTimeout(close, 15); else close(); } });
  if (options.keepClosed) { const rect = f.w.HTMLElement.prototype.getBoundingClientRect;
    f.w.HTMLElement.prototype.getBoundingClientRect = function () { if (this.getAttribute('role') === 'dialog') return { width: 200, height: 100 }; return rect.call(this); }; }
  return { ...f, clicks, modeToggles, state: () => ({ model, mode }) };
}
test('Qianwen daily page without model control represents the actual mode only', async () => {
  const f = setup(); try {
    const r = plain(await f.command({ kind: 'options' })); assert.equal(r.ok, true); assert.equal(r.catalog.primary, 'mode');
    assert.deepEqual(r.catalog.models, ['快速', '思考研究']); assert.deepEqual(r.catalog.efforts, []);
    assert.equal((await f.command({ kind: 'verify', preset: { model: '思考研究', effort: null } })).ok, true);
    assert.equal(f.state().mode, '快速'); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Qianwen model cards expose model-dependent modes and never click Set default', async () => {
  const f = setup({ models: true }); try {
    const r = plain(await f.command({ kind: 'options', model: 'Qwen9 Preview' })); assert.equal(r.ok, true);
    assert.deepEqual(r.catalog.models, ['Qwen3.7-千问', 'Qwen9 Preview']); assert.deepEqual(r.catalog.efforts, ['快速']);
    assert.equal(f.state().model, 'Qwen3.7-千问'); assert.equal(f.clicks.includes('default-trap'), false);
    assert.equal((await f.command({ kind: 'verify', preset: { model: 'Qwen9 Preview', effort: '思考研究' } })).ok, false);
    assert.equal(f.state().model, 'Qwen3.7-千问');
  } finally { f.close(); }
});
test('Qianwen rejects missing controls and swallowed mode changes', async () => {
  const f = setup({ ignore: true }); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: '思考研究', effort: null } })).ok, false);
    f.d.querySelector('[role="tab"]').remove(); assert.equal((await f.command({ kind: 'current' })).ok, false);
  } finally { f.close(); }
});

test('Qianwen future mode labels stay addressable and restore the original choice', async () => {
  const f = setup({ future: true }); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: '未来模式', effort: null } })).ok, true);
    assert.equal(f.state().mode, '快速'); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
test('Qianwen unrelated top dialog is never a model candidate', async () => {
  const f = setup(); try {
    f.d.body.insertAdjacentHTML('beforeend', '<div class="desktop-no-drag"><button aria-haspopup="dialog" aria-controls="help">帮助</button></div>');
    assert.deepEqual(plain((await f.command({ kind: 'current' })).current), { model: '快速', effort: null });
    assert.equal((await f.command({ kind: 'options' })).catalog.primary, 'mode');
  } finally { f.close(); }
});

test('Qianwen closes a mode menu that ignores Escape using its expanded trigger', async () => {
  const f = setup({ noEscape: true }); try {
    assert.equal((await f.command({ kind: 'options' })).ok, true); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});

test('Qianwen closes its menu once even when Escape commits asynchronously', async () => {
  const f = setup({ asyncClose: true }); try {
    assert.equal((await f.command({ kind: 'current' })).ok, true);
    assert.equal(f.modeToggles.length, 2); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});

test('Qianwen ignores the geometry of a model dialog whose logical state is closed', async () => {
  const f = setup({ models: true, keepClosed: true }); try {
    assert.equal((await f.command({ kind: 'current' })).ok, true);
  } finally { f.close(); }
});

test('Qianwen waits for the preceding popup transition before selecting and closing modes', async () => {
  const f = setup({ transition: true }); try {
    assert.equal((await f.command({ kind: 'verify', preset: { model: '思考研究', effort: null } })).ok, true);
    assert.equal(f.state().mode, '快速'); assert.equal(f.menus(), 0);
  } finally { f.close(); }
});
