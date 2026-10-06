import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
const render = (value: string) => renderToStaticMarkup(<MarkdownPreview value={value} onOpenLink={() => undefined} />);

test('answer tables preserve headers and inline formatting without exposing raw pipes', () => {
  const html = render('| Option | Note |\n| --- | --- |\n| **Read** | `a\\|b` |');
  assert.match(html, /<table>/);
  assert.match(html, /<th[^>]*>Option<\/th>/);
  assert.match(html, /<td[^>]*><strong>Read<\/strong><\/td>/);
  assert.match(html, /<code>a\|b<\/code>/);
});

test('ordered lists retain starting number and nested bullet lists', () => {
  const html = render('3. Read answers\n   - First detail\n   - Second detail\n4. Compare answers');
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<li>Read answers<ul><li>First detail<\/li><li>Second detail<\/li><\/ul><\/li>/);
  assert.match(html, /<li>Compare answers<\/li>/);
});

test('external links allow only http and https, never execute HTML or URL schemes', () => {
  const html = render('[Docs](https://example.com/a?q=1) [bad](javascript:alert) [file](file:///etc/passwd) <img src=x onerror=alert(1)>');
  assert.match(html, /href="https:\/\/example.com\/a\?q=1"/);
  assert.doesNotMatch(html, /href="(?:javascript|file):/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('fenced code remains verbatim and quotes retain consecutive lines', () => {
  const html = render('```md\n| A | B |\n1. **literal**\n```\n\n> One\n> Two');
  assert.doesNotMatch(html, /<table>|<ol>|<strong>/);
  assert.match(html, /<code>\| A \| B \|\n1\. \*\*literal\*\*<\/code>/);
  assert.equal((html.match(/<blockquote>/g) ?? []).length, 1);
  assert.match(html, /One\nTwo/);
});

test('adjacent citations stay separate and parentheses inside URLs remain intact', () => {
  const html = render('[1](https://one.example/a)[2](https://two.example/b) [topic](https://example.com/wiki/Topic_(detail))');
  assert.equal((html.match(/<a /g) ?? []).length, 3);
  assert.match(html, /href="https:\/\/one.example\/a"/);
  assert.match(html, /href="https:\/\/two.example\/b"/);
  assert.match(html, /href="https:\/\/example.com\/wiki\/Topic_\(detail\)"/);
});

test('large unmatched link delimiters stay readable without stalling the shell', () => {
  const input = '['.repeat(60_000);
  const start = performance.now();
  assert.ok(render(input).includes(input));
  assert.ok(performance.now() - start < 1000, 'an unmatched delimiter run must not cause quadratic backtracking');
});

test('escaped punctuation stays literal and code may contain backticks', () => {
  const html = render('a\\_i 与 b\\_j；\\*字面星号\\*；`` a`b ``');
  assert.match(html, /a_i 与 b_j；\*字面星号\*；<code>a`b<\/code>/);
  assert.doesNotMatch(html, /<em>|\\_/);
});

test('long URL labels are compact while full destinations and meaningful labels survive', () => {
  const target = 'https://poe2db.tw/cn/Rune#:~:text=' + '%E6%A0%B9'.repeat(100);
  const html = render(`[${target}](${target}) [配方资料](${target})`);
  assert.equal((html.match(/href="https:\/\/poe2db.tw\/cn\/Rune#:~:text=/g) ?? []).length, 2);
  assert.match(html, />poe2db.tw\/cn\/Rune<\/a>/);
  assert.match(html, />配方资料<\/a>/);
  assert.doesNotMatch(html, />https:\/\/poe2db/);
  const code = render('```txt\n' + target + '\n```');
  assert.ok(code.includes('<code>' + target));
});

test('reference links and empty labels use the same readable link renderer', () => {
  const html = render('详情 [资料][doc] 与 [](https://two.example/a)\n\n[doc]: https://one.example/b');
  assert.match(html, /href="https:\/\/one.example\/b"[^>]*>资料<\/a>/);
  assert.match(html, /href="https:\/\/two.example\/a"[^>]*>two.example\/a<\/a>/);
});

test('long URL labels compact when capture encoded parentheses only in the destination', () => {
  const label = 'https://example.com/wiki/Topic_(detail)?q=' + 'x'.repeat(100);
  const target = label.replace(/\(/g, '%28').replace(/\)/g, '%29');
  const html = render(`[${label}](${target})`);
  assert.match(html, />example.com\/wiki\/Topic_%28detail%29<\/a>/);
  assert.ok(html.includes(`href="${target}"`));
});

test('Mermaid fences expose preview controls and preserve source; ordinary code stays plain', () => {
  const source = 'flowchart LR\n  A --> B\n\n\n  B --> C';
  const html = render('```mermaid\n' + source + '\n```');
  assert.match(html, /class="mermaid-preview"/);
  assert.match(html, /aria-label="Copy diagram source"/);
  assert.ok(html.includes('<code>' + source.replace(/>/g, '&gt;') + '</code>'));
  assert.doesNotMatch(render('```js\nconsole.log(1)\n```'), /mermaid-preview/);
});
