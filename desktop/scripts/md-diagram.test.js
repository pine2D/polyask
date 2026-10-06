const assert = require('node:assert/strict');
const test = require('node:test');
const { listFixtures, loadFixture, replayFixture, replayHtml } = require('./lib/dom-replay');
const source = 'flowchart LR\n  A[开始] --> B{检查}\n\n\n  B --> C[保存]';
const fence = '```mermaid\n' + source + '\n```';
const escaped = source.replace(/>/g, '&gt;');
const card = `<div class="code-no-artifacts"><div class="top"><p class="language">mermaid</p><div class="tabs"><p>代码</p><p>预览</p></div></div>
  <div class="markdown-body md-code-inner-container" style="display:none"><div class="language language-mermaid" lang="mermaid"><pre><code>${escaped}</code><span aria-hidden="true">1 2 3</span></pre></div></div>
  <div class="mermaid-render"><svg><text>rendered labels</text></svg></div></div>`;
const hosts = ['claude.ai', 'chatgpt.com', 'gemini.google.com', 'chat.deepseek.com', 'www.doubao.com', 'www.qianwen.com', 'www.kimi.com', 'yuanbao.tencent.com', 'chatglm.cn'];
for (const host of hosts) {
  test(`${host}: production turn captures shared Mermaid source with intact whitespace`, () => {
    const fixture = listFixtures().map(name => loadFixture(name)).find(f => f.meta.host === host && f.meta.expect.answer);
    assert.ok(fixture, host);
    const run = replayFixture(fixture);
    try {
      const answer = run.adapter.historyTurn().answer;
      assert.ok(answer);
      answer.innerHTML = `<p>before</p>${card}<p>after</p><div style="display:none"><code>private hidden content</code></div>`;
      const original = answer.outerHTML;
      assert.equal(run.S.toMarkdown(run.adapter.historyTurn().answer), `before\n\n${fence}\n\nafter`);
      assert.equal(answer.outerHTML, original, 'capture is read-only');
    } finally { run.close(); }
  });
}
test('standard Mermaid language markers and missing-source preview have a common fallback', () => {
  const run = replayHtml('<main></main>', { host: 'chatglm.cn' });
  try {
    const root = run.document.querySelector('main');
    for (const html of [
      `<pre class="mermaid">${escaped}</pre>`,
      `<pre data-language="mermaid"><code>${escaped}</code></pre>`,
      `<div class="language-mermaid"><pre><code>${escaped}</code></pre></div>`,
      `<pre><code class="language-mermaid">${escaped}</code></pre>`
    ]) { root.innerHTML = html; assert.equal(run.S.toMarkdown(root), fence); }
    root.innerHTML = '<div class="mermaid-render"><svg><text>A</text></svg></div><p>keep</p>';
    assert.equal(run.S.toMarkdown(root), '```mermaid\n\n```\n\nkeep', 'SVG alone cannot reconstruct source');
    root.innerHTML = '<div hidden class="language-mermaid"><pre><code>hidden unrelated</code></pre></div><p>keep</p>';
    assert.equal(run.S.toMarkdown(root), 'keep');
  } finally { run.close(); }
});

test('semantic preview cards without DOM source emit a missing-source fence, excluding their controls', () => {
  const run = replayHtml('<main></main>', { host: 'chatglm.cn' });
  try {
    const root = run.document.querySelector('main');
    for (const html of [
      '<div class="mermaidBox-abcd"><div>图表</div><div>代码</div><svg></svg></div>',
      '<div class="md-code-block"><div role="tablist"><div role="tab">图表</div><div role="tab">代码</div></div><svg class="mermaid-svg"></svg></div>',
      '<div data-mermaid="true" role="img" aria-label="Mermaid diagram"></div>',
      '<div data-example-mermaid-preview=""><button>图表选项</button><div data-code-block-preview-pane="mermaid"><svg></svg></div></div>'
    ]) { root.innerHTML = html; assert.equal(run.S.toMarkdown(root), '```mermaid\n\n```'); }
  } finally { run.close(); }
});

test('unlabelled code with a definite Mermaid syntax header is captured; explicit other languages are preserved', () => {
  const run = replayHtml('<main></main>', { host: 'gemini.google.com' });
  try {
    const root = run.document.querySelector('main');
    root.innerHTML = `<code-block><div class="code-block"><div class="code-block-decoration"><span>Code snippet</span><button>Copy</button></div><pre><code>${escaped}</code></pre></div></code-block>`;
    assert.equal(run.S.toMarkdown(root), fence);
    root.innerHTML = `<pre><code class="language-text">${escaped}</code></pre>`;
    assert.equal(run.S.toMarkdown(root), fence.replace('```mermaid', '```text'));
    root.innerHTML = '<pre><code>graph = {nodes: []}</code></pre>';
    assert.equal(run.S.toMarkdown(root), '```\ngraph = {nodes: []}\n```');
  } finally { run.close(); }
});

test('Doubao diagram toolbar alignment cannot replace the bound user turn or hide its answer', () => {
  const fixture = listFixtures().map(name => loadFixture(name)).find(f => f.meta.host === 'www.doubao.com' && f.meta.expect.answer);
  const run = replayFixture(fixture);
  try {
    const before = run.adapter.historyTurn();
    assert.ok(before.answer);
    const originalUser = before.user, originalKey = before.userKey, originalCount = before.userCount;
    before.answer.innerHTML = `<div class="diagram"><div class="justify-end"><button data-testid="diagram-zoom-in-btn">+</button></div><pre class="language-mermaid"><code>${escaped}</code></pre></div>`;
    const after = run.adapter.historyTurn();
    assert.ok(after.user === originalUser, 'a right-aligned answer control is not a user message');
    assert.equal(after.userKey, originalKey);
    assert.equal(after.userCount, originalCount);
    assert.ok(after.answer === before.answer);
    assert.equal(run.S.toMarkdown(after.answer), fence);
  } finally { run.close(); }
});

test('linked tab panels expose only their marked Mermaid source without leaking unrelated hidden code', () => {
  const run = replayHtml('<main></main>', { host: 'www.doubao.com' });
  try {
    const root = run.document.querySelector('main');
    const tabs = `<div class="generic-tabs"><header><div role="tablist"><button role="tab" aria-controls="source-one">代码</button><button role="tab" aria-controls="preview-one">流程图</button></div></header><div><div role="tabpanel" id="preview-one"><svg><text>rendered</text></svg></div><div role="tabpanel" id="source-one" aria-hidden="true"><pre class="language-mermaid"><code>${escaped}</code></pre></div></div></div>`;
    root.innerHTML = `<p>before</p>${tabs}<p>after</p><div hidden><pre class="language-mermaid">private hidden code</pre></div>`;
    const original = root.outerHTML;
    assert.equal(run.S.toMarkdown(root), `before\n\n${fence}\n\nafter`);
    assert.equal(root.outerHTML, original, 'tabs are not switched during capture');
    root.innerHTML = tabs + '<p>between</p>' + tabs.replaceAll('-one', '-two');
    assert.equal(run.S.toMarkdown(root), `${fence}\n\nbetween\n\n${fence}`, 'each card retains its position');
    root.innerHTML = tabs.replace('aria-controls="source-one"', 'aria-controls="other"');
    assert.ok(!run.S.toMarkdown(root).includes(source), 'a hidden pane without a matching tab is not read');
  } finally { run.close(); }
});

test('transparent export watermarks cannot enter a diagram answer snapshot', () => {
  const run = replayHtml(`<main><p>before</p><pre class="language-mermaid"><code>${escaped}</code></pre><div style="opacity:0"><img alt="export logo"><p>Export brand</p><pre><code>private export content</code></pre></div><p>after</p></main>`, { host: 'www.doubao.com' });
  try { assert.equal(run.S.toMarkdown(run.document.querySelector('main')), `before\n\n${fence}\n\nafter`); }
  finally { run.close(); }
});
