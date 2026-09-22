const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/site-runtime/upload.js'), 'utf8');
function fixture({ count = 4, busy = false, hiddenBusy = false, sameSource = false, retained = false, shiftingHistory = false, pendingDraft = false } = {}) {
  let now = 1000, shown = false, changes = 0;
  const rect = { left: 100, right: 500, top: 450, bottom: 500, width: 400, height: 50 };
  const node = (tag, cls, src = '') => ({ tagName: tag, className: cls, src, textContent: '',
    getAttribute: () => '', getBoundingClientRect: () => rect, contains: () => false,
    closest: selector => retained && selector.includes('data-chat-input-top-content') ? { getBoundingClientRect: () => rect } : null });
  const images = Array.from({ length: count }, (_, i) => node('IMG', 'preview-image', sameSource ? 'same.png' : `${i}.png`));
  const wrappers = Array.from({ length: 3 }, () => ({ ...node('DIV', 'upload-preview'), querySelector: () => images[0], contains: el => images.includes(el) }));
  const spinner = node('DIV', 'loading');
  if (hiddenBusy) spinner.parentElement = { hiddenOpacity: true };
  const doc = { querySelectorAll(selector) {
    if (selector.startsWith('[data-testid="input-attachment-list"]')) return pendingDraft ? [{ ...node('DIV', 'image-thumbnail loading'), hiddenOpacity: true }] : [];
    if (!shown) return shiftingHistory && selector.startsWith('img,canvas') ? Array.from({ length: 4 }, (_, i) => node('IMG', 'old-message', `old-${i}.png`)) : [];
    if (selector.startsWith('img,canvas')) return [...wrappers, ...images];
    if (selector.startsWith('[role="progressbar"]')) return busy ? [spinner] : [];
    return [];
  } };
  const S = { sleep: async ms => { now += ms; } };
  const context = { window: { __AMS: S }, document: doc, location: { href: 'https://test/chat' }, Date: { now: () => now },
    getComputedStyle: el => ({ display: 'block', visibility: 'visible', opacity: el.hiddenOpacity ? '0' : '1', backgroundImage: 'none' }),
    Event: class {}, DataTransfer: class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } },
    File: class { constructor(parts, name) { this.name = name; this.size = parts[0].length; } },
    atob: s => Buffer.from(s, 'base64').toString('binary'), createImageBitmap: async () => ({ close() {} }) };
  vm.runInNewContext(source, context);
  const input = { dispatchEvent() { shown = true; changes++; } }, composer = { getBoundingClientRect: () => rect };
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png` }));
  const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const payloads = files.map(f => ({ ...f, type: 'image/png', size: data.length, dataUrl: `data:image/png;base64,${data.toString('base64')}` }));
  return { S, input, composer, files, payloads, now: () => now, changes: () => changes, clear: () => { shown = false; },
    adapter: { attach: (files, el, deadline) => S.setInputFiles(input, files, el, deadline) } };
}
test('one image plus nested preview containers cannot confirm four images', async () => {
  const h = fixture({ count: 1 });
  assert.equal(await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000), false);
});
test('visible uploading remains a blocker after five seconds', async () => {
  const h = fixture({ busy: true });
  assert.equal(await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000), false);
});
test('spinner inside a transparent ancestor does not block completed previews', async () => {
  const h = fixture({ busy: true, hiddenBusy: true });
  assert.equal(await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000), true);
});
test('four independent images with identical URLs retain their multiplicity', async () => {
  const h = fixture({ sameSource: true });
  assert.equal(await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000), true);
});
test('retry reuses only the unchanged confirmed attachments and never uploads them twice', async () => {
  const h = fixture();
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 10000)).ok, true);
  const changes = h.changes();
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 10000)).ok, true);
  assert.equal(h.changes(), changes);
  const different = h.payloads.map(p => ({ ...p, name: `new-${p.name}` }));
  assert.equal((await h.S.uploadImages(different, h.adapter, h.composer, h.now() + 10000)).code, 'attachment_conflict');
  assert.equal(h.changes(), changes);
});
test('partial attachment failure blocks retry until the remaining attachments are removed', async () => {
  const h = fixture({ count: 1 });
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 1000)).ok, false);
  const changes = h.changes();
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 1000)).code, 'attachment_conflict');
  assert.equal(h.changes(), changes);
  h.clear();
  await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 1000);
  assert.ok(h.changes() > changes);
});
test('retained native draft attachments without a receipt require explicit cleanup', async () => {
  const h = fixture({ retained: true });
  await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000);
  let called = 0;
  h.adapter.attach = () => { called++; return true; };
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 1000)).code, 'attachment_conflict');
  assert.equal(called, 0, '不能向保留的原生草稿追加上传');
});
test('old message images leaving the anchor region do not cancel the new attachment count', async () => {
  const h = fixture({ shiftingHistory: true });
  assert.equal(await h.S.setInputFiles(h.input, h.files, h.composer, h.now() + 10000), true);
});
test('hidden pending native attachments block uploads even during the editor entrance animation', async () => {
  const h = fixture({ pendingDraft: true }); let called = false;
  h.adapter.attach = () => { called = true; return true; };
  assert.equal((await h.S.uploadImages(h.payloads, h.adapter, h.composer, h.now() + 1000)).code, 'attachment_conflict');
  assert.equal(called, false);
});
