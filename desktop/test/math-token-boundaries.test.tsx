import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { mountTechnical, formulaSource } from './ui/technical-reading-dom';

test('a link label lookahead cannot consume the later standalone formula', async () => {
  const value = '[label \\(](https://example.com) and \\(x\\)';
  const h = await mountTechnical(value);
  try {
    await h.render(<MarkdownPreview value={value} onOpenLink={() => {}} />);
    assert.equal(h.document.querySelector('a')?.getAttribute('href'), 'https://example.com/');
    assert.equal(h.document.querySelectorAll('.markdown-math').length, 1);
    assert.equal(formulaSource(h.document), '\\(x\\)');
    assert.equal(h.document.querySelector('a button') === null, true);
    assert.equal(h.jobs.length, 0);
  } finally { await h.close(); }
});

test('an exclusive single-line display formula preserves both dollar delimiters', async () => {
  const h = await mountTechnical('$$x^2$$');
  try {
    assert.equal(h.document.querySelectorAll('.markdown-math').length, 1);
    assert.equal(formulaSource(h.document), '$$x^2$$');
    assert.equal(h.document.querySelector('.markdown-math-block') !== null, true);
  } finally { await h.close(); }
});

test('an unmatched explicit formula opener remains literal instead of losing its backslash', async () => {
  const h = await mountTechnical('Before \\(unclosed text');
  try {
    assert.equal(h.document.querySelector('.markdown-math') === null, true);
    assert.equal(h.document.querySelector('p')?.textContent, 'Before \\(unclosed text');
  } finally { await h.close(); }
});

test('supported inline delimiters each preserve literal source without eager rendering', async () => {
  const h = await mountTechnical('Inline \\(x+1\\), display \\[x^2\\], and $x$.');
  try {
    const sources = h.document.querySelectorAll('.markdown-math-source');
    assert.equal(sources.length, 3);
    assert.equal(sources[0].textContent, '\\(x+1\\)');
    assert.equal(sources[1].textContent, '\\[x^2\\]');
    assert.equal(sources[2].textContent, '$x$');
    assert.equal(h.jobs.length, 0);
  } finally { await h.close(); }
});

test('formula-like delimiters inside a code fence stay ordinary exact code', async () => {
  const h = await mountTechnical('```text\n$$x$$ \\(y\\)\n```');
  try {
    assert.equal(h.document.querySelector('.markdown-math') === null, true);
    assert.equal(h.document.querySelector('pre code')?.textContent, '$$x$$ \\(y\\)');
  } finally { await h.close(); }
});
