const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture(host) {
  const editor = { closest: () => ({}), getBoundingClientRect: () => ({ width: 384, height: 3252, top: 281, bottom: 3533, left: 0, right: 384 }) };
  const composer = { closest: () => null, getBoundingClientRect: () => ({ width: 405, height: 26, top: 912, bottom: 938, left: 0, right: 405 }) };
  const context = { window: {}, location: { hostname: host }, innerWidth: 467, innerHeight: 1012,
    document: { querySelectorAll: () => [editor, composer] } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/site-runtime/core.js'), 'utf8'), context);
  return { editor, composer, selected: context.window.__AMS.findComposer() };
}
test('ChatGPT answer editor cannot replace the actual prompt composer when its canvas grows', () => {
  const f = fixture('chatgpt.com'); assert.equal(f.selected === f.composer, true);
});
test('other sites retain the existing composer geometry selection', () => {
  const f = fixture('example.com'); assert.equal(f.selected === f.editor, true);
});
