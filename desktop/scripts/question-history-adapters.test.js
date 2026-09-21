const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/site-runtime/history-adapters.js'), 'utf8');
function fixture(host, selector, nodes) {
  const answer = { isConnected: true };
  const adapter = { answer: () => answer };
  vm.runInNewContext(source, { window: { __AMS: { adapters: { [host]: adapter } } },
    document: { querySelectorAll: s => s === selector ? nodes : [] } });
  return adapter;
}
function user(text, children = {}) {
  return { isConnected: true, innerText: text, querySelector: s => children[s] ?? null,
    contains: () => false, compareDocumentPosition: () => 4, getAttribute: () => null };
}
test('DeepSeek empty assistant placeholder is not counted as a user turn', () => {
  const u = user('Synthetic question', { '.ds-collapsible-text': {} });
  const emptyAssistant = user('');
  const a = fixture('deepseek.com', '.ds-message', [u, emptyAssistant]);
  assert.equal(a.historyTurn().userCount, 1);
  assert.equal(a.historyTurn().user, u);
});
for (const [host, selector] of [['qianwen.com', '.question-text-card'], ['chatglm.cn', '.conversation.question .question-txt']]) {
  test(`${host} binds the verified user text node instead of navigation or guessed class names`, () => {
    const u = user('Synthetic question');
    const a = fixture(host, selector, [u]);
    assert.equal(a.historyTurn().user, u);
    assert.equal(a.historyTurn().text, 'Synthetic question');
  });
}
test('Gemini reads only prompt lines, excluding its repeated screen-reader label', () => {
  const u = user('You said Question Question');
  u.querySelectorAll = s => s === '.query-text-line' ? [{ innerText: 'Question' }] : [];
  const a = fixture('gemini.google.com', 'user-query', [u]);
  assert.equal(a.historyTurn().text, 'Question');
});
function doubaoNode(text, image = false, assistant = false) {
  const n = user(text, image ? { img: {} } : {});
  n.matches = selector => selector === '[class*="justify-end"]' && !assistant;
  return n;
}
test('Doubao image bubbles followed by text count as one contiguous user turn', () => {
  const image = doubaoNode('', true), text = doubaoNode('Question');
  const a = fixture('doubao.com', '[data-message-id]', [image, text]);
  assert.equal(a.historyTurn().userCount, 1);
  assert.equal(a.historyTurn().user, text);
});
test('Doubao never merges separate text turns or images across an assistant response', () => {
  const image = doubaoNode('', true), reply = doubaoNode('Answer', false, true), text = doubaoNode('Question');
  assert.equal(fixture('doubao.com', '[data-message-id]', [image, reply, text]).historyTurn().userCount, 2);
  assert.equal(fixture('doubao.com', '[data-message-id]', [text, doubaoNode('Question')]).historyTurn().userCount, 2);
  const a = fixture('doubao.com', '[data-message-id]', [text, reply, image]);
  assert.equal(a.historyTurn().userCount, 2);
  assert.equal(a.historyTurn().user, image, 'a direct image follow-up must replace the latest user and end prior ownership');
});
test('Doubao predecessor uses the prior logical text turn, not its image bubble', () => {
  const old = doubaoNode('Earlier'), image = doubaoNode('', true), text = doubaoNode('Question');
  old.getAttribute = () => 'old'; image.getAttribute = () => 'image'; text.getAttribute = () => 'new';
  const a = fixture('doubao.com', '[data-message-id]', [old, doubaoNode('Answer', false, true), image, text]);
  assert.equal(a.historyTurn().previousUserKey, 'old');
  assert.equal(a.historyTurn().userKey, 'new');
});
