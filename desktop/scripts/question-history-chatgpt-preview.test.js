const assert = require('node:assert/strict');
const test = require('node:test');
const { replayHtml } = require('./lib/dom-replay');

// 2026-10-22 真机时序：首问先出现无消息 key 的首页预览；它留在隐藏 workspace 中，
// 带 search-unit-key 的真实消息已插入另一 workspace。两份同文不代表两次提交。
function setup(t) {
  const h = replayHtml('<main><section id="home"></section><section id="thread"></section>'
    + '<form><textarea id="prompt-textarea"></textarea></form></main>', { host: 'chatgpt.com' });
  t.after(h.close);
  h.adapter.answer = () => h.document.querySelector('.markdown');
  const preview = () => h.document.querySelector('#home').insertAdjacentHTML('beforeend',
    '<div data-thread-user-message-navigation-content><div data-user-message-bubble>Question</div></div>');
  const turn = (id = 'user-1') => h.document.querySelector('#thread').insertAdjacentHTML('beforeend',
    `<div data-content-search-unit-key="${id}"><div data-user-message-bubble>Question</div></div>`);
  const answer = () => h.document.querySelector('#thread').insertAdjacentHTML('beforeend',
    '<div data-content-search-unit-key="answer-1"><div class="markdown">Answer</div></div>');
  const tick = () => new Promise(resolve => h.window.setTimeout(resolve, 0));
  return { ...h, preview, turn, answer, tick };
}

for (const images of [0, 1]) {
  test(`ChatGPT first turn (${images} image) ignores the optimistic preview through real message insertion`, async t => {
    const h = setup(t);
    h.S.history.begin('token', 'Question', Date.now() + 5000, { images });
    h.preview(); await h.tick();
    assert.equal(h.S.history.submitted('token'), false, 'the homepage preview alone is not submission evidence');
    assert.equal(h.S.history.snapshot('token').owned, false, 'fallback must not bind the same preview');
    h.document.querySelector('#home').style.display = 'none';
    h.window.history.replaceState(null, '', '/c/WEB%3Asynthetic');
    h.turn(); await h.tick();
    assert.equal(h.adapter.historyTurn({ method: 'selector' }).userCount, 1);
    assert.equal(h.S.history.submitted('token'), true);
    h.window.history.replaceState(null, '', '/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    h.answer(); await h.tick();
    const result = h.S.history.snapshot('token');
    assert.equal(result.owned, true);
    assert.equal(result.text, 'Answer');
    assert.equal(result.ended === true, false);
  });
}

test('ChatGPT a preview that never becomes a real message stays unconfirmed', async t => {
  const h = setup(t);
  h.S.history.begin('token', 'Question');
  h.preview(); await h.tick();
  h.answer(); await h.tick();
  const result = h.S.history.snapshot('token');
  assert.equal(result.owned, false);
  assert.equal(result.captureCode, 'turn_unconfirmed');
});

test('ChatGPT two actual keyed user messages still stop attribution', async t => {
  const h = setup(t);
  h.S.history.begin('token', 'Question', Date.now() + 5000, { images: 1 });
  h.preview(); await h.tick();
  h.turn('user-1'); h.turn('user-2'); h.answer(); await h.tick();
  const result = h.S.history.snapshot('token');
  assert.equal(result.owned, false);
  assert.equal(result.ended, true);
  assert.equal(result.captureCode, 'turn_changed');
});

test('ChatGPT legacy user wrapper still counts once and excludes its copy control', t => {
  const h = setup(t);
  h.document.querySelector('#thread').innerHTML = '<div data-message-author-role="user">'
    + '<div data-user-message-bubble>Question</div><button>Copy</button></div>';
  const result = h.adapter.historyTurn();
  assert.equal(result.userCount, 1);
  assert.equal(result.text, 'Question');
});
