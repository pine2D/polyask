const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('ChatGLM returns the full split answer body and never falls back to thoughts', () => {
  const body = { kind: 'body with introduction, code and conclusion' };
  const thought = { closest: selector => selector === '.text-advance-thinking-content' ? {} : null };
  const paragraph = { closest: selector => selector === '.answer-content-wrap' ? body : null };
  const code = { closest: selector => selector === '.answer-content-wrap' ? body : null };
  let parts = [thought];
  const host = { querySelectorAll: () => parts };
  const S = { adapters: {}, helpers: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/site-runtime/adapters-cn2.js'), 'utf8'), {
    window: { __AMS: S }, document: { querySelectorAll: selector => selector === '.answer-content' ? [host] : [] },
    globalThis: { __AMS_I18N__: { t: x => x } }
  });
  const a = S.adapters['chatglm.cn'];
  assert.equal(a.answer(), null, 'thought-only content is not the answer');
  parts = [thought, paragraph, code, paragraph];
  assert.equal(a.answer(), body, 'all body paragraphs and code share the returned container');
});
