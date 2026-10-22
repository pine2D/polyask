const assert = require('node:assert/strict');
const test = require('node:test');
const { replayHtml } = require('./lib/dom-replay');

const user = (text, id = '', failed = false) => '<div data-testid="union_message" data-target-id="reused">'
  + `<div data-message-role="user"${id ? ` data-message-id="${id}"` : ''}>`
  + (failed ? '<svg data-testid="message_box_failed_icon"></svg>' : '')
  + `<div data-testid="message_text_content">${text}</div></div></div>`;
function setup(t, onSend) {
  const h = replayHtml('<main><section></section><textarea></textarea><button id="flow-end-msg-send">Send</button></main>',
    { host: 'www.doubao.com', path: '/chat/12345678901234567' });
  t.after(h.close);
  h.window.HTMLElement.prototype.getBoundingClientRect = () => ({left:100,right:500,top:450,bottom:500,width:400,height:50});
  let now = 1000, clicks = 0, delayed;
  h.window.Date.now = () => now;
  h.window.setTimeout = (fn, ms) => {
    if (ms > 10000) return 1;
    now += ms;
    if (delayed && now >= delayed.at) { const action = delayed.action; delayed = null; action(); }
    queueMicrotask(fn); return 1;
  };
  h.window.clearTimeout = () => {};
  h.S.armGeneration = () => {};
  const composer = h.document.querySelector('textarea'), thread = h.document.querySelector('section');
  h.document.querySelector('button').onclick = () => { clicks++; composer.value = ''; onSend(thread, h); };
  return { ...h, thread, clicks: () => clicks, now: () => now,
    delay: (ms, action) => { delayed = { at: now + ms, action }; },
    ask: (deadline = 6000) => h.send({ source: 'AMS', cmd: 'submitPrompt', text: 'Question', deadline, historyToken: 'token' }) };
}

for (const failed of [false, true]) test(`Doubao does not confirm a cleared composer with only an optimistic user bubble (failed: ${failed})`, async t => {
  const h = setup(t, thread => thread.insertAdjacentHTML('beforeend', user('Question', '', failed)));
  const r = await h.ask();
  assert.equal(r.ok, false);
  assert.equal(r.code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
  assert.equal(h.now() <= 6000, true);
});

test('Doubao confirms a new independent user message id without a second click', async t => {
  const h = setup(t, thread => thread.insertAdjacentHTML('beforeend', user('Question', 'new-message')));
  const r = await h.ask();
  assert.equal(r.ok, true);
  assert.equal(h.clicks(), 1);
});

test('Doubao does not reuse an old keyed same-text message as confirmation', async t => {
  const h = setup(t, () => {});
  h.thread.innerHTML = user('Question', 'old-message');
  const r = await h.ask();
  assert.equal(r.code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
});

test('Doubao explicit failure wins over a new message id', async t => {
  const h = setup(t, thread => thread.insertAdjacentHTML('beforeend', user('Question', 'new-message', true)));
  assert.equal((await h.ask()).code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
});

test('Doubao confirmation waits only to the absolute deadline and does not click again', async t => {
  const h = setup(t, thread => thread.insertAdjacentHTML('beforeend', user('Question')));
  assert.equal((await h.ask(1350)).code, 'submit_unconfirmed');
  assert.equal(h.now(), 1350);
  assert.equal(h.clicks(), 1);
});


test('Doubao waits past three seconds for independent confirmation within the shared deadline', async t => {
  const h = setup(t, thread => {
    thread.insertAdjacentHTML('beforeend', user('Question'));
    h.delay(4000, () => thread.querySelector('[data-message-role="user"]').setAttribute('data-message-id', 'late-message'));
  });
  assert.equal((await h.ask(7000)).ok, true);
  assert.equal(h.now() > 5000 && h.now() <= 7000, true);
  assert.equal(h.clicks(), 1);
});

test('Doubao can send without history but cannot claim confirmation', async t => {
  const h = setup(t, thread => thread.insertAdjacentHTML('beforeend', user('Question', 'new-message')));
  assert.equal((await h.S.submitPrompt('Question', 6000, [])).code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
});

test('Doubao checks deadline after inspecting the button and immediately before dispatch', async t => {
  const h = setup(t, () => {});
  Object.defineProperty(h.document.querySelector('button'), 'disabled', { get: () => {
    h.window.Date.now = () => 1200; return false;
  }});
  await assert.rejects(h.adapter.submit(h.document.querySelector('textarea'), 1100), { message: 'timeout' });
  assert.equal(h.clicks(), 0);
});

test('Doubao switching to an older same-text conversation cannot confirm this click', async t => {
  const h = setup(t, (thread, runtime) => {
    runtime.window.history.pushState(null, '', '/chat/99999999999999999');
    thread.innerHTML = user('Question', 'old-other-conversation');
  });
  h.thread.innerHTML = user('Previous', 'baseline-user');
  assert.equal((await h.ask()).code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
});

test('Doubao exposing an already existing earlier same-text turn cannot confirm this click', async t => {
  const h = setup(t, thread => thread.lastElementChild.remove());
  h.thread.innerHTML = user('Question', 'older-user') + user('Previous', 'baseline-user');
  assert.equal((await h.ask()).code, 'submit_unconfirmed');
  assert.equal(h.clicks(), 1);
});
