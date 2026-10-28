import assert from 'node:assert/strict';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { safeExportMarkdown } from '../src/main/markdown-export-format';
test('Markdown keeps headings, nested lists, tables, code and math', () => {
  const result = safeExportMarkdown('# 标题\n\n- 第一项\n  - 子项\n\n| 列 | 值 |\n| --- | --- |\n| 中文 | **重点** |\n\n```js\n# untouched\nconst x = `<script>x()</script>`;\n```\n\n行内 `a*b` 与 $a_b < c$\n\n$$\nx_{n+1}=x_n^2\n$$\n\n```mermaid\ngraph LR\nA-->B\n```', 3);
  assert.match(result, /^#### 标题/m); assert.match(result, /# untouched\nconst x = `<script>x\(\)<\/script>`;/);
  assert.match(result, /\$a_b < c\$/); assert.match(result, /x_\{n\+1\}=x_n\^2/);
  const html = new MarkdownIt({ html: true }).render(result);
  assert.match(html, /<table>/); assert.match(html, /<strong>重点<\/strong>/); assert.match(html, /<li>子项/); assert.match(html, /language-mermaid/);
});
test('HTML and unsafe links become inert text; safe links and image descriptions remain', () => {
  const result = safeExportMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=boom()>\n\n[bad](javascript:alert(1)) [ok](https://example.com/a) ![图注](https://example.com/a.png)\n\n<https://example.com> [jump](#local)', 3);
  const parser = new MarkdownIt({ html: true }); parser.validateLink = () => true;
  const html = parser.render(result);
  assert.equal(/<script|<img|href="javascript:|onerror="/i.test(html), false);
  assert.match(html, /href="https:\/\/example.com\/a"/); assert.match(html, /图注/); assert.match(html, /href="#local"/);
});
test('nested block math keeps one quote prefix and escaped currency stays literal', () => {
  const result = safeExportMarkdown('> $$\n> a_b < c\n> $$\n\n\\$x\\$ and `$$code$$`', 3);
  assert.match(result, /^> a_b < c$/m); assert.equal(result.includes('> >'), false);
  assert.match(result, /\\\$x\\\$/); assert.match(result, /` \$\$code\$\$ `/);
});


test('escaped block markers and image punctuation stay literal after exporting', () => {
  const source = String.raw`\- literal dash

\+ literal plus

1\. literal number

\~\~literal tildes\~\~

plain text
\=\=\=

\![text link](https://example.com/image.png)`;
  const parser = new MarkdownIt({ html: true });
  const rendered = parser.render(safeExportMarkdown(source, 0));
  assert.equal(rendered.includes('<img'), false, 'a literal exclamation mark must never turn the next link into an image');
  assert.equal(rendered, parser.render(source));
});


test('an image without alt text becomes a visible source link', () => {
  const html = new MarkdownIt().render(safeExportMarkdown('![](https://example.com/image.png)', 0));
  assert.equal(html.includes('<img'), false);
  assert.match(html, />https:\/\/example\.com\/image\.png<\/a>/);
});
