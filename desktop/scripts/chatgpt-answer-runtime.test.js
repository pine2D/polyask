'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const modern = '[data-content-search-unit-key]:has([data-conversation-role="assistant"]) [data-markdown-text-style="assistant-message"]';
function setup(matches) {
  const S = { adapters: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/site-runtime/adapters-intl2.js'), 'utf8'), {
    window: { __AMS: S }, document: { querySelectorAll: selector => matches[selector] || [] }
  });
  return S.adapters['chatgpt.com'];
}
test('ChatGPT reads the newest verified assistant Markdown, excluding user bubbles and thought containers', () => {
  const old = {}, latest = {};
  assert.equal(setup({ [modern]: [old, latest] }).answer(), latest);
  assert.equal(setup({ '[data-user-message-bubble]': [{}], '[data-markdown-text-style="thought"]': [{}] }).answer(), null);
});
test('ChatGPT retains both older answer layouts', () => {
  for (const selector of ['[data-turn="assistant"]', '[data-message-author-role="assistant"]']) {
    const markdown = {}, turn = { querySelector: s => s === '.markdown' ? markdown : null };
    assert.equal(setup({ [selector]: [turn] }).answer(), markdown);
  }
});
