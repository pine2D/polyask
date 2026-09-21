const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture(missingItem = false, expires = false, existing = false) {
  let now = 1000;
  let opened = false, input = null, listener = null, escaped = false, pickerPrevented = false;
  const field = { tagName: 'INPUT', matches: s => s === 'input[type="file"]' };
  if (existing) input = field;
  const add = { click: () => { opened = true; } };
  const item = { textContent: 'Upload Image', click: () => {
    input = field;
    listener?.({ target: field, preventDefault: () => { pickerPrevented = true; } });
  } };
  const document = {
    querySelector: selector => {
      if (selector.includes('input')) { if (input && expires) now = 6000; return input; }
      return selector.includes('Add') ? add : null;
    },
    querySelectorAll: () => opened && !missingItem ? [item] : [],
    addEventListener: (name, fn) => { assert.equal(name, 'click'); listener = fn; },
    removeEventListener: () => { listener = null; }
  };
  const S = { adapters: {}, waitFor: async fn => fn(), sleep: async ms => { now += ms; }, escMenus: () => { escaped = true; },
    dropFiles: async () => false, setInputFiles: async n => n === field && pickerPrevented,
    findByText: (selector, re) => document.querySelectorAll(selector).find(n => re.test(n.textContent)) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/site-runtime/adapters-cn3.js'), 'utf8'), {
    window: { __AMS: S }, document, Date: { now: () => now }, globalThis: { __AMS_I18N__: { t: x => x } }
  });
  return { a: S.adapters['yuanbao.tencent.com'], state: () => ({ listener, escaped, pickerPrevented }) };
}
test('Yuanbao opens its image input without a native chooser and uploads via the input', async () => {
  const f = fixture();
  assert.equal(await f.a.attach([{}], {}, 5000), true);
  assert.deepEqual(f.state(), { listener: null, escaped: true, pickerPrevented: true });
});
test('Yuanbao missing image menu cleans up and never reports an upload', async () => {
  const f = fixture(true);
  assert.equal(await f.a.attach([{}], {}, 5000), false);
  assert.equal(f.state().listener, null);
  assert.equal(f.state().escaped, true);
});

test('Yuanbao refuses an input that appears after the absolute deadline', async () => {
  const f = fixture(false, true);
  assert.equal(await f.a.attach([{}], {}, 5000), false);
  assert.equal(f.state().listener, null);
  assert.equal(f.state().escaped, true);
});

test('Yuanbao refreshes its upload menu even when a previous input remains', async () => {
  const f = fixture(false, false, true);
  assert.equal(await f.a.attach([{}], {}, 5000), true);
  assert.equal(f.state().pickerPrevented, true);
});
