const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { source, helpers } = require('./lib/site-send-harness');

// Sanitized structure observed in the live ChatGPT composer on 2026-10-21.
const inputs = `
  <input id="camera" type="file" accept="image/*" capture="environment">
  <input id="media" type="file" accept="image/*,video/*" multiple>
  <input id="photos" type="file" accept="image/*" multiple class="hidden">
  <input id="files" type="file" multiple>`;

function fixture(t, html = inputs, outside = '') {
  const dom = new JSDOM(`${outside}<form>${html}<div contenteditable="true"></div></form>`);
  t.after(() => dom.window.close());
  const document = dom.window.document, calls = [];
  const context = helpers(document, { setInputFiles: async (input, files, composer, deadline) => {
    if (!input) return false;
    calls.push({ id: input.id, files, composer, deadline });
    return true;
  } });
  context.Date = { now: () => 1000 };
  vm.runInNewContext(source('adapters-intl2.js'), context);
  return { adapter: context.window.__AMS.adapters['chatgpt.com'], document, calls,
    composer: document.querySelector('[contenteditable]') };
}

for (const label of ['Attach photos', '添加照片']) {
  test(`ChatGPT uploads via the current form's image input with a dynamic ID (${label})`, async t => {
    const h = fixture(t, inputs, '<input id="avatar" type="file" accept="image/*" multiple>');
    h.document.getElementById('photos').id = '_r_d_';
    h.document.getElementById('_r_d_').setAttribute('aria-label', label);
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png` }));
    assert.equal(await h.adapter.attach(files, h.composer, 1800), true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].id, '_r_d_');
    assert.equal(h.calls[0].files === files, true);
    assert.equal(h.calls[0].composer === h.composer, true);
    assert.equal(h.calls[0].deadline, 1800);
  });
}

test('ChatGPT retains its legacy photo input', async t => {
  // The known legacy ID must work independently of the modern accept/multiple selector.
  const h = fixture(t, '<input id="upload-photos" type="file">');
  assert.equal(await h.adapter.attach([{}], h.composer, 1800), true);
  assert.equal(h.calls[0].id, 'upload-photos');
});

for (const [name, html] of [
  ['camera and video inputs', '<input type="file" accept="image/*" capture="environment" multiple><input type="file" accept="image/*,video/*" multiple>'],
  ['generic file input', '<input type="file" multiple>'],
  ['disabled photo input', '<input type="file" accept="image/*" multiple disabled>'],
  ['disabled fieldset', '<fieldset disabled><input type="file" accept="image/*" multiple></fieldset>'],
  ['ambiguous photo inputs', '<input type="file" accept="image/*" multiple><input type="file" accept="image/*" multiple>'],
  ['disabled legacy input', '<input id="upload-photos" type="file" disabled>']
]) {
  test(`ChatGPT refuses ${name} without touching unrelated inputs`, async t => {
    const h = fixture(t, html, '<input id="avatar" type="file" accept="image/*" multiple>');
    assert.equal(await h.adapter.attach([{}], h.composer, 1800), false);
    assert.equal(h.calls.length, 0);
  });
}

test('ChatGPT does not upload after the shared absolute deadline', async t => {
  const h = fixture(t, '<input id="upload-photos" type="file" multiple>');
  assert.equal(await h.adapter.attach([{}], h.composer, 1000), false);
  assert.equal(h.calls.length, 0);
});

test('ChatGPT forwards upload failure without switching input or uploading twice', async t => {
  const h = fixture(t);
  h.document.getElementById('photos').id = 'upload-photos';
  const calls = [];
  const context = helpers(h.document, { setInputFiles: async input => { calls.push(input.id); return false; } });
  vm.runInNewContext(source('adapters-intl2.js'), context);
  assert.equal(await context.window.__AMS.adapters['chatgpt.com'].attach([{}], h.composer, Date.now() + 1000), false);
  assert.deepEqual(calls, ['upload-photos']);
});
