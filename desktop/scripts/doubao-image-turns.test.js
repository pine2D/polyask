const assert = require('node:assert/strict');
const test = require('node:test');
const { replayHtml, replayFixture } = require('./lib/dom-replay');

// 2026-10-22 真机：图片占位和文字是两个 union_message，data-target-id 相同。
// img 晚于两个用户气泡出现；旧 data-message-id 仅覆盖部分已确认消息。
const user = (key, text, id = '') => `<div data-testid="union_message" data-target-id="${key}">`
  + '<div data-testid="message-block-container"><div data-testid="send_message" data-message-role="user">'
  + (id ? `<div data-message-id="${id}">` : '')
  + (text ? `<div data-testid="message_text_content">${text}</div>` : '<div class="image-placeholder"></div>')
  + (id ? '</div>' : '') + '</div></div></div>';
const old = '<div data-message-id="old" class="justify-end">Old cached text</div>';
const answer = '<div data-message-id="reply"><div class="md-box-root">Answer</div></div>';
function setup(t, path = '/chat/') {
  const h = replayHtml('<main><section id="thread"></section><textarea></textarea></main>', { host: 'www.doubao.com', path });
  t.after(h.close);
  const append = html => h.document.querySelector('#thread').insertAdjacentHTML('beforeend', html);
  const tick = () => new Promise(resolve => h.window.setTimeout(resolve, 0));
  return { ...h, append, tick };
}

test('Doubao groups keyed image placeholders with their text before img loads and ignores old partial markers', async t => {
  const h = setup(t);
  h.S.history.begin('token', 'Question', Date.now() + 10000, { images: 1 });
  h.window.history.pushState(null, '', '/chat/local_123456789');
  h.append(user('current', '') + user('current', 'Question')); await h.tick();
  assert.equal(h.adapter.historyTurn().userCount, 1);
  assert.equal(h.S.history.submitted('token'), false);
  h.document.querySelectorAll('[data-message-role="user"]')[1].setAttribute('data-message-id', 'confirmed-user');
  h.document.querySelector('#thread').insertAdjacentHTML('afterbegin', old);
  h.window.history.replaceState(null, '', '/chat/12345678901234567');
  h.append(answer); await h.tick();
  const result = h.S.history.snapshot('token');
  assert.equal(result.owned, true);
  assert.equal(result.text, 'Answer');
  assert.equal(result.locate, 'selector');
});

test('Doubao recognizes a modern follow-up while previous messages still have legacy markers', async t => {
  const h = setup(t, '/chat/12345678901234567');
  h.append(old + user('previous', '') + user('previous', 'Earlier', 'previous-message') + answer);
  h.S.history.begin('token', 'Question');
  h.append(user('current', 'Question', 'current-message') + answer.replace('reply', 'reply-2')); await h.tick();
  const turn = h.adapter.historyTurn();
  assert.equal(turn.userCount, 2);
  assert.equal(turn.previousUserKey, 'previous-message');
  assert.equal(turn.text, 'Question');
  assert.equal(h.S.history.snapshot('token').text, 'Answer');
});

for (const separator of ['', '<div data-message-role="assistant">Reply</div>']) {
  test(`Doubao does not merge text follow-ups reusing the previous target id (assistant: ${!!separator})`, async t => {
    const h = setup(t, '/chat/12345678901234567');
    h.append(user('reused', 'Earlier', 'previous-message') + separator);
    h.S.history.begin('token', 'Question');
    h.append(user('reused', 'Question')); await h.tick();
    const turn = h.adapter.historyTurn();
    assert.equal(turn.userCount, 2);
    assert.equal(turn.previousUserKey, 'previous-message');
    assert.equal(turn.userKey, null);
    assert.equal(h.S.history.snapshot('token').owned, false);
    assert.equal(h.S.history.snapshot('token').captureCode, 'turn_unconfirmed');
  });
}

test('Doubao an unkeyed assistant ends an image placeholder group even with the same target id', async t => {
  const h = setup(t);
  h.append(user('reused', '') + '<div data-message-role="assistant">Reply</div>' + user('reused', 'Question'));
  await h.tick();
  assert.equal(h.adapter.historyTurn().userCount, 2);
});

test('Doubao adding an independent message id inside the connected user role keeps ownership', async t => {
  const h = setup(t, '/chat/12345678901234567');
  h.append(user('previous', 'Earlier', 'previous-message') + answer);
  h.S.history.begin('token', 'Question');
  h.append(user('current', 'Question')); await h.tick();
  assert.equal(h.S.history.snapshot('token').owned, false);
  assert.equal(h.S.history.snapshot('token').ended, false);
  const role = h.document.querySelectorAll('[data-message-role="user"]')[1];
  const inner = h.document.createElement('div');
  inner.setAttribute('data-message-id', 'current-message');
  inner.append(...role.childNodes); role.append(inner);
  h.append(answer.replace('reply', 'new-reply')); await h.tick();
  assert.equal(h.adapter.historyTurn().user === role, true);
  assert.equal(h.adapter.historyTurn().userKey, 'current-message');
  assert.equal(h.S.history.snapshot('token').text, 'Answer');
});

test('Doubao different keyed image and text messages never collapse into one turn', async t => {
  const h = setup(t);
  h.S.history.begin('token', 'Question');
  h.window.history.pushState(null, '', '/chat/local_123456789');
  h.append(user('image-only-turn', '') + user('next-turn', 'Question')); await h.tick();
  assert.equal(h.adapter.historyTurn().userCount, 2);
  assert.equal(h.S.history.snapshot('token').captureCode, 'turn_changed');
});

// 旧版逐站 answer() 依赖 message-id；无独立 key 的回答由语义级定位。
for (const method of ['selector', 'semantic']) for (const keyed of method === 'selector' ? [true] : [true, false]) {
  test(`Doubao ${method} keeps answer identity separate from its user turn (answer key: ${keyed})`, async t => {
    const h = replayFixture('doubao-single-turn');
    t.after(h.close);
    if (method === 'semantic') h.adapter.historyTurn = ctx => h.S.historyLocate.locate({ ...ctx, method });
    const user = h.document.querySelector('[data-polyask-expect="user"]');
    const answer = h.document.querySelector('[data-polyask-expect="answer-root"]');
    const userWrapper = user.closest('[data-testid="union_message"]');
    const answerWrapper = answer.closest('[data-testid="union_message"]');
    assert.equal(userWrapper.getAttribute('data-target-id'), answerWrapper.getAttribute('data-target-id'));
    if (!keyed) answer.removeAttribute('data-message-id');
    const parent = userWrapper.parentElement, answerParent = answerWrapper.parentElement;
    userWrapper.remove(); answerWrapper.remove();
    h.S.history.begin('token', user.querySelector('[data-testid="message_text_content"]').textContent);
    parent.append(userWrapper); answerParent.append(answerWrapper);
    await new Promise(resolve => h.window.setTimeout(resolve, 0));
    const first = h.S.history.snapshot('token');
    assert.equal(first.owned, true);
    assert.equal(typeof first.text, 'string');
    const root = method === 'semantic' ? answer.closest('[data-message-role="assistant"]') : answer;
    const replacement = root.cloneNode(true);
    if (keyed) (replacement.matches('[data-message-id]') ? replacement : replacement.querySelector('[data-message-id]'))
      .setAttribute('data-message-id', 'new-answer');
    replacement.querySelector('[data-testid="message_text_content"]').innerHTML = '<p>Another response.</p>';
    root.replaceWith(replacement);
    await new Promise(resolve => h.window.setTimeout(resolve, 0));
    const result = h.S.history.snapshot('token');
    assert.equal(result.owned, false);
    assert.equal(result.captureCode, 'answer_changed');
    assert.equal(result.text, undefined);
  });
}
