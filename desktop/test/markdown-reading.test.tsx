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
