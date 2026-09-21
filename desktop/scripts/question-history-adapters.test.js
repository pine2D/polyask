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
