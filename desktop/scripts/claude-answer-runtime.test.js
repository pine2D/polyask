const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture(modern, legacy = []) {
  const S = { adapters: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/site-runtime/adapters-intl.js'), 'utf8'), {
    window: { __AMS: S }, document: { querySelectorAll: selector =>
      selector === '[data-testid="assistant-message"]' ? modern : selector === '.font-claude-response' ? legacy : [] }
  });
  return S.adapters['claude.ai'];
}
const message = blocks => ({ querySelectorAll: selector => selector === '[data-perf-reply-text]' ? blocks : [] });

test('Claude reads the latest modern reply block without the retired font class', () => {
  const old = { text: 'Old answer' }, intro = { text: 'I will analyze this' }, final = { text: 'Final answer' };
  const a = fixture([message([old]), message([intro, final])]);
  assert.equal((a.answer()) === (final), true);
});

test('Claude modern thought-only turn cannot fall back to an older answer or whole thought container', () => {
  const old = { querySelector: () => null, text: 'Old answer' };
  const a = fixture([message([])], [old]);
  assert.equal((a.answer()) === (null), true);
});

test('Claude keeps the verified legacy grid-body fallback', () => {
  const body = { text: 'Legacy answer' };
  const old = { querySelector: selector => selector === '.row-start-2' ? body : null };
  assert.equal((fixture([], [old]).answer()) === (body), true);
});
