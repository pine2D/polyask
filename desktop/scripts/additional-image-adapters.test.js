const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { source, helpers } = require('./lib/site-send-harness');

function fixture(file, host, mode = 'ok') {
  let now = 1000, menu = false, inputReady = false, closed = 0, attached = null;
  const listeners = new Set(), events = [], waits = [];
  const input = { type: 'file' }, wrong = { avatar: true };
  const item = { textContent: '上传图片', click() {
    let prevented = false;
    for (const listener of listeners) listener({ target: { matches: () => true }, preventDefault() { prevented = true; } });
    assert.ok(prevented, '菜单创建 input 时必须阻止系统选择窗'); inputReady = true;
  } };
  const add = { getAttribute: () => 'Upload & tools', click() { menu = true; inputReady = true; },
    dispatchEvent(e) { events.push(e); if (e.type === 'pointerdown' && e.pointerType === 'mouse') menu = true; }
  };
  const document = {
    querySelector(selector) {
      if (selector.includes('button[')) return mode === 'missing' ? null : add;
      if (selector.includes('.upload-demo')) return mode === 'missing' ? null : input;
      if (selector === 'input[type="file"]') return wrong;
      return inputReady && mode !== 'missing' ? input : null;
    },
    querySelectorAll(selector) {
      if (selector === 'button') return mode === 'missing' ? [] : [add];
      if (selector.includes('menuitem')) return menu && mode !== 'missing' ? [item] : [];
      return [];
    },
    addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); }
  };
  const context = helpers(document, {
    waitFor: async (find, ms) => { waits.push(ms); if (mode === 'expired') now = 3000; return find(); },
    setInputFiles: async (node, files, el, deadline) => { attached = { node, files, el, deadline }; if (mode === 'throw') throw Error('upload failed'); return mode !== 'failed'; },
    escMenus() { closed++; menu = false; }
  });
  context.Date = { now: () => now };
  context.PointerEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
  vm.runInNewContext(source(file), context);
  return { adapter: context.window.__AMS.adapters[host], input, events, waits, listeners,
    result: () => ({ attached, closed, menu }) };
}

for (const [label, file, host] of [
  ['Gemini', 'adapters-intl.js', 'gemini.google.com'],
  ['千问', 'adapters-cn.js', 'qianwen.com'],
  ['智谱', 'adapters-cn2.js', 'chatglm.cn']
]) {
  test(`${label} uses its chat image input and forwards all files and the original deadline`, async () => {
    const f = fixture(file, host), files = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png` })), el = {};
    assert.equal(await f.adapter.attach(files, el, 1800), true);
    assert.deepEqual(f.result().attached, { node: f.input, files, el, deadline: 1800 });
    assert.ok(f.waits.every(ms => ms <= 800));
    assert.equal(f.listeners.size, 0);
    if (label !== '智谱') assert.equal(f.result().closed, 1);
    if (label === '千问') assert.ok(f.events.every(e => e.pointerType === 'mouse'));
  });
  test(`${label} never uploads after its deadline or falls back to an unrelated input`, async () => {
    const f = fixture(file, host, 'missing');
    assert.equal(await f.adapter.attach([{}], {}, 900), false);
    assert.equal(f.result().attached, null);
    assert.notEqual(await f.adapter.attach([{}], {}, 1800), true);
    assert.equal(f.result().attached, null);
    assert.equal(f.listeners.size, 0);
  });
  test(`${label} preserves failure and cleans up if upload throws`, async () => {
    const f = fixture(file, host, 'throw');
    await assert.rejects(async () => f.adapter.attach([{}], {}, 1800));
    assert.equal(f.listeners.size, 0);
    if (label !== '智谱') assert.equal(f.result().closed, 1);
  });
  if (label !== '智谱') test(`${label} rechecks deadline after awaiting the menu`, async () => {
    const f = fixture(file, host, 'expired');
    assert.equal(await f.adapter.attach([{}], {}, 1800), false);
    assert.equal(f.result().attached, null);
    assert.equal(f.listeners.size, 0);
  });
}
