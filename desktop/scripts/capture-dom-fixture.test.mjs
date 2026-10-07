// 采集脚本的离线对拍：不连 CDP、不碰真站点。把两段求值表达式放进 jsdom 回放的生产运行时里跑一遍，
// 证明隔离上下文的路径换算与主世界的脱敏输出能对上，产物过入库扫描并可原样回放。
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isolatedExpression, mainExpression, sanitizeRoute, promptTokenText } from './capture-dom-fixture.mjs';

const require = createRequire(import.meta.url);
const { replayHtml } = require('./lib/dom-replay.js');
const { scanHtml } = require('./lib/dom-fixture-scan.js');
const source = await readFile(new URL('./lib/dom-fixture-sanitize.js', import.meta.url), 'utf8');

test('route ids become placeholders while route shape survives', () => {
  assert.equal(sanitizeRoute('https://www.kimi.com/chat/19a8f3c2-0d1e-4b5a-9c8d-7e6f5a4b3c2d'), '/chat/id-1');
  assert.equal(sanitizeRoute('https://chatgpt.com/c/WEB:abc123#x'), '/c/id-1');
  assert.equal(sanitizeRoute('https://chatglm.cn/main/alltoolsdetail?cid=6789abcd&lang=zh'), '/main/alltoolsdetail?cid=id-1');
  assert.equal(sanitizeRoute('https://gemini.google.com/app'), '/app');
});

test('multi-line prompts map to numbered tokens', () => {
  assert.equal(promptTokenText('one line', 'POLYASK_PROMPT'), 'POLYASK_PROMPT');
  assert.equal(promptTokenText('first\n\nsecond', 'POLYASK_PROMPT'), 'POLYASK_PROMPT-L1\nPOLYASK_PROMPT-L2');
});

test('isolated probe + main-world sanitizer produce a scannable, replayable fixture', () => {
  const prompt = 'Synthetic capture question';
  const page = `<main><div class="chat-content-list">
    <div class="chat-content-item chat-content-item-user" data-message-id="u-1"><div class="user-content">${prompt}</div></div>
    <div class="chat-content-item chat-content-item-assistant" data-message-id="a-1"><div class="markdown"><p>Real answer text</p></div></div>
  </div></main>`;
  const live = replayHtml(page, { host: 'www.kimi.com', path: '/chat/abc' });
  let probe, output;
  try {
    const context = live.dom.getInternalVMContext();
    // JSON 往返 = CDP returnByValue：只有可序列化的值能离开页面。
    const evaluate = (expression) => JSON.parse(JSON.stringify(vm.runInContext(expression, context)));
    probe = evaluate(isolatedExpression(source, { root: 'main', prompt }));
    assert.equal(probe.ok, true);
    assert.equal(probe.textMatches, true);
    assert.deepEqual(probe.missing, []);
    assert.deepEqual(probe.marks.map((mark) => mark.token), ['user', 'answer', 'answer-root']);
    assert.equal(evaluate(mainExpression(source, { root: 'main', prompt, token: 'POLYASK_PROMPT', marks: probe.marks, elementCount: probe.elementCount + 1 })).code,
      'dom_changed', '两段之间元素数变化必须拒绝出片');
    output = evaluate(mainExpression(source, { root: 'main', prompt, token: 'POLYASK_PROMPT', marks: probe.marks, elementCount: probe.elementCount }));
    assert.equal(live.window.module, undefined, '注入的脱敏器不得在页面留下全局');
    assert.equal(live.window.__polyaskDomFixtureSanitize, undefined, '注入的脱敏器不得在页面留下全局');
  } finally { live.close(); }
  assert.equal(output.ok, true);
  assert.deepEqual(scanHtml(output.html, 'POLYASK_PROMPT'), []);
  assert.doesNotMatch(output.html, /Synthetic|Real answer|u-1|a-1/);
  const replay = replayHtml(output.html, { host: 'www.kimi.com', path: '/chat/id-1' });
  try {
    const turn = replay.adapter.historyTurn();
    assert.equal(turn.text, 'POLYASK_PROMPT');
    assert.equal((turn.user) === (replay.document.querySelector('[data-polyask-expect~="user"]')), true);
    assert.equal((turn.answer) === (replay.document.querySelector('[data-polyask-expect~="answer"]')), true);
    assert.equal((turn.answerRoot) === (replay.document.querySelector('[data-polyask-expect~="answer-root"]')), true);
  } finally { replay.close(); }
});
