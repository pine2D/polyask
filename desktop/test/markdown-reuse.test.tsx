import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import MarkdownIt from 'markdown-it';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

test('unchanged bodies reuse actual parsed tokens across parent renders', async t => {
  const parsed: string[] = []; const original = MarkdownIt.prototype.parse;
  t.mock.method(MarkdownIt.prototype, 'parse', function(this: InstanceType<typeof MarkdownIt>, source: string, env: Parameters<typeof original>[1]) {
    parsed.push(source); return original.call(this, source, env);
  });
  const render = (revision: number, second = 'Second **answer**') => <section data-revision={revision}>
    <MarkdownPreview value="First **answer**" /><MarkdownPreview value={second} />
  </section>;
  const h = await mountDom(render(1));
  try {
    assert.equal(parsed.join('|'), 'First **answer**|Second **answer**');
    await h.render(render(2)); assert.equal(parsed.length, 2, 'same values do not parse again');
    await h.render(render(3, 'Changed **answer**'));
    assert.equal(parsed.join('|'), 'First **answer**|Second **answer**|Changed **answer**');
    assert.equal(h.document.querySelectorAll('.markdown-preview strong').length, 2);
  } finally { await h.close(); }
});

test('reused tokens still use the current link handler and language without altering source', async t => {
  let parses = 0; const original = MarkdownIt.prototype.parse;
  t.mock.method(MarkdownIt.prototype, 'parse', function(this: InstanceType<typeof MarkdownIt>, source: string, env: Parameters<typeof original>[1]) {
    parses++; return original.call(this, source, env);
  });
  const calls: string[] = []; const source = '[Source](https://example.test/source)\n\n```js\n\tconst exact = 1;\n```';
  const h = await mountDom(<MarkdownPreview value={source} onOpenLink={url => calls.push(`old:${url}`)} />);
  try {
    h.document.documentElement.lang = 'zh-CN';
    await h.render(<MarkdownPreview value={source} onOpenLink={url => calls.push(`new:${url}`)} />);
    await h.click(h.document.querySelector<HTMLAnchorElement>('.markdown-preview a')!);
    assert.equal(calls.join(','), 'new:https://example.test/source');
    assert.equal([...h.document.querySelectorAll('.markdown-code button')].some(node => node.textContent === getCopy('zh-CN').readingCopyCode), true);
    assert.equal(h.document.querySelector('pre code')?.textContent, '\tconst exact = 1;');
    assert.equal(parses, 1);
  } finally { await h.close(); }
});

test('token reuse stays scoped to the mounted reader rather than retaining a global body cache', async t => {
  let parses = 0; const original = MarkdownIt.prototype.parse;
  t.mock.method(MarkdownIt.prototype, 'parse', function(this: InstanceType<typeof MarkdownIt>, source: string, env: Parameters<typeof original>[1]) {
    parses++; return original.call(this, source, env);
  });
  const h = await mountDom(<MarkdownPreview value="Current saved source" />);
  try {
    await h.render(<div>Another record</div>);
    await h.render(<MarkdownPreview value="Current saved source" />);
    assert.equal(parses, 2); assert.equal(h.document.querySelector('.markdown-preview')?.textContent, 'Current saved source');
  } finally { await h.close(); }
});
