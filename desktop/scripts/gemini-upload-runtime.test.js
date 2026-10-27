"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { source } = require('./lib/intl-harness');

function harness({ accept = 'image/*,video/*', existing = false, fail = false, expired = false, waitThrows = false, waitExpires = false, waitError = 'timeout' } = {}) {
  const dom = new JSDOM('<button aria-label="Upload &amp; tools" aria-expanded="false"></button><div contenteditable="true"></div>');
  const document = dom.window.document, button = document.querySelector('button');
  const composer = document.querySelector('div'), received = [], clicks = [];
  let now = 1000;
  const mount = () => {
    if (document.querySelector('#media')) return;
    composer.insertAdjacentHTML('afterend', `<input type="file" accept="image/*" capture="camera">
      <input type="file" accept=".pdf,.txt"><input type="file" accept="image/*" disabled>
      <input id="media" type="file" accept="${accept}" multiple>`);
  };
  button.onclick = () => { clicks.push('toggle'); button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true')); mount(); };
  if (existing) mount();
  const S = { adapters: {}, escMenus() {}, waitFor: async (fn) => { if (waitThrows) { if (waitExpires) now = 2000; throw Error(waitError); } if (expired) now = 2000; return fn(); },
    setInputFiles: async (input, files, target, deadline) => {
      received.push({ id: input.id, files: files.length, target: target === composer, deadline });
      if (fail) throw Error('upload_failed'); return true;
    } };
  const context = { window: { __AMS: S }, document, Date: { now: () => now }, t: key => key,
    File: dom.window.File, Uint8Array, atob: value => Buffer.from(value, 'base64').toString('binary'),
    createImageBitmap: async () => ({ close() {} }), getComputedStyle: dom.window.getComputedStyle,
    location: { href: 'https://gemini.google.com/app' } };
  vm.runInNewContext(source('adapters-intl3.js'), context);
  return { adapter: S.adapters['gemini.google.com'], composer, received, clicks,
    open: () => button.getAttribute('aria-expanded') === 'true', close: () => dom.window.close(),
    upload: async () => {
      vm.runInNewContext(source('upload.js'), context);
      return S.uploadImages([{ type: 'image/png', size: 8, name: 'test.png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }], S.adapters['gemini.google.com'], composer, 2000);
    } };
}
for (const accept of ['image/*,video/*', ' IMAGE/* , video/* ', 'image/*']) {
  test(`Gemini attaches through the media input (${accept}) and closes its upload menu`, async () => {
    const h = harness({ accept });
    try {
      assert.equal(await h.adapter.attach([{}], h.composer, 2000), true);
      assert.deepEqual(h.received, [{ id: 'media', files: 1, target: true, deadline: 2000 }]);
      assert.equal(h.open(), false);
    } finally { h.close(); }
  });
}
test('Gemini uses an existing media input without opening the upload menu', async () => {
  const h = harness({ existing: true });
  try { assert.equal(await h.adapter.attach([{}], h.composer, 2000), true); assert.equal(h.clicks.length, 0); }
  finally { h.close(); }
});
test('Gemini never injects into camera, disabled or document-only inputs', async () => {
  const h = harness({ accept: '.pdf' });
  try { assert.equal(await h.adapter.attach([{}], h.composer, 2000), false); assert.equal(h.received.length, 0); assert.equal(h.open(), false); }
  finally { h.close(); }
});
test('Gemini closes the upload menu after expiry without assigning files', async () => {
  const h = harness({ expired: true });
  try { assert.equal(await h.adapter.attach([{}], h.composer, 2000), false); assert.equal(h.received.length, 0); assert.equal(h.open(), false); }
  finally { h.close(); }
});
test('Gemini closes the upload menu even when attachment confirmation throws', async () => {
  const h = harness({ fail: true });
  try { await assert.rejects(h.adapter.attach([{}], h.composer, 2000), /upload_failed/); assert.equal(h.open(), false); }
  finally { h.close(); }
});

test('Gemini closes the menu when the deadline waiter throws before assigning files', async () => {
  const h = harness({ waitThrows: true });
  try { await assert.rejects(h.adapter.attach([{}], h.composer, 2000), /timeout/); assert.equal(h.received.length, 0); assert.equal(h.open(), false); }
  finally { h.close(); }
});

for (const [waitExpires, waitError, code] of [[true, 'timeout', 'attachment_timeout'],
  [false, 'timeout', 'attachment_failed'], [true, 'menu_failed', 'attachment_failed']]) {
  test(`Gemini upload pipeline preserves ${code} for ${waitError}, expired=${waitExpires}`, async () => {
    const h = harness({ waitThrows: true, waitExpires, waitError });
    try {
      const result = await h.upload();
      assert.equal(result.ok, false); assert.equal(result.code, code);
      assert.equal(h.received.length, 0); assert.equal(h.open(), false);
    } finally { h.close(); }
  });
}
