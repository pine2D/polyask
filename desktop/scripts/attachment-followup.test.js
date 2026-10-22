"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source } = require('./lib/site-send-harness');

function fixture(t, { outsideForm = false } = {}) {
  const dom = new JSDOM('<main><article id="answer"><img src="old-answer.png"></article><form><div id="attachments"></div><textarea></textarea></form></main>',
    { url: 'https://fixture.invalid/chat', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, document = w.document;
  const composer = document.querySelector('textarea'), attachments = document.querySelector('#attachments');
  if (outsideForm) document.querySelector('form').before(attachments);
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 100, right: 500, top: 450, bottom: 500, width: 400, height: 50 });
  let now = 1000, clicks = 0;
  w.Date.now = () => now;
  w.setTimeout = (fn, ms) => { now += ms; queueMicrotask(fn); return 1; };
  w.clearTimeout = () => {};
  w.createImageBitmap = async () => ({ close() {} });
  w.t = key => key;
  w.chrome = { runtime: { onMessage: { addListener() {} } } };
  w.eval(source('core.js')); w.eval(source('upload.js'));
  const S = w.__AMS;
  S.sendBtn = () => ({ disabled: false, click() { clicks++; composer.value = ''; } });
  const add = () => attachments.insertAdjacentHTML('beforeend', '<img class="preview-image" src="pending.png">');
  const data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const images = [{ name: 'fixture.png', type: 'image/png', size: data.length, dataUrl: `data:image/png;base64,${data.toString('base64')}` }];
  return { S, document, composer, attachments, add, clicks: () => clicks,
    upload: ok => S.uploadImages(images, { attach: async () => { add(); return ok; } }, composer, now + 5000),
    send: () => S.submitPrompt('Plain follow-up', now + 5000, []) };
}

for (const ok of [true, false]) test(`text-only follow-up blocks ${ok ? 'confirmed' : 'failed'} upload leftovers outside a form`, async t => {
  const h = fixture(t, { outsideForm: true });
  await h.upload(ok); h.composer.value = 'Existing site draft';
  const result = await h.send();
  assert.equal(result.code, 'attachment_conflict');
  assert.equal(h.composer.value, 'Existing site draft', 'do not overwrite the site draft before refusing');
  assert.equal(h.clicks(), 0, 'no submit action with unseen attachments');
});

test('text-only follow-up blocks native attachments with no runtime receipt', async t => {
  const h = fixture(t); h.add();
  assert.equal((await h.send()).code, 'attachment_conflict');
  assert.equal(h.clicks(), 0);
});

test('text-only follow-up blocks hidden pending thumbnails during entrance animation', async t => {
  const h = fixture(t);
  h.attachments.outerHTML = '<div data-testid="input-attachment-list" style="opacity:0"><div class="image-thumbnail"></div></div>';
  assert.equal((await h.send()).code, 'attachment_conflict');
  assert.equal(h.clicks(), 0);
});

test('after removing the pending attachment, old answer images do not prevent a plain follow-up', async t => {
  const h = fixture(t); await h.upload(false); h.attachments.replaceChildren();
  assert.equal((await h.send()).ok, true);
  assert.equal(h.clicks(), 1);
});

test('a normal plain question with only historical answer images sends once', async t => {
  const h = fixture(t);
  assert.equal((await h.send()).ok, true);
  assert.equal(h.clicks(), 1);
});

test('an image re-rendered in conversation history after manual submission is not a pending draft', async t => {
  const h = fixture(t, { outsideForm: true });
  await h.upload(true); h.attachments.replaceChildren();
  h.document.querySelector('#answer').insertAdjacentHTML('beforeend', '<img src="pending.png">');
  assert.equal((await h.send()).ok, true);
  assert.equal(h.clicks(), 1);
});

test('re-rendering an upload preview in its original draft region does not bypass the plain-text guard', async t => {
  const h = fixture(t, { outsideForm: true }); await h.upload(false);
  const original = h.attachments.querySelector('img'); original.replaceWith(original.cloneNode(true));
  assert.equal((await h.send()).code, 'attachment_conflict');
  assert.equal(h.clicks(), 0);
});

for (const moveRegion of [false, true]) test(`moving the original ${moveRegion ? 'preview region' : 'image node'} into history stops treating it as a draft`, async t => {
  const h = fixture(t, { outsideForm: true }); await h.upload(true);
  h.document.querySelector('#answer').append(moveRegion ? h.attachments : h.attachments.querySelector('img'));
  assert.equal((await h.send()).ok, true);
  assert.equal(h.clicks(), 1);
});

test('composer remount during upload keeps pending attachments tied to the current draft', async t => {
  const h = fixture(t, { outsideForm: true });
  const append = h.attachments.insertAdjacentHTML.bind(h.attachments);
  h.attachments.insertAdjacentHTML = (...args) => { append(...args); h.composer.replaceWith(h.composer.cloneNode(true)); };
  await h.upload(false);
  assert.equal(h.composer.isConnected, false);
  assert.equal(h.S.hasPendingAttachments(h.document.querySelector('textarea')), true);
  assert.equal((await h.send()).code, 'attachment_conflict');
  assert.equal(h.clicks(), 0);
});
