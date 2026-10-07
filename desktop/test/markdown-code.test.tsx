import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { mountTechnical, technicalButton } from './ui/technical-reading-dom';

test('ordinary code exposes its language without interpreting source as Markdown or HTML', async () => {
  const h = await mountTechnical('```js\n\tconst x = "<script>";\n```');
  try {
    assert.equal(h.document.querySelector('.markdown-code-language')?.textContent, 'js');
    assert.equal(h.document.querySelector('pre code')?.textContent, '\tconst x = "<script>";');
    assert.equal(h.document.querySelector('script') === null, true);
    assert.equal(h.document.querySelector('pre strong') === null, true);
  } finally { await h.close(); }
});

test('copy preserves code tabs and the original token trailing newline', async () => {
  const copied: string[] = [];
  const h = await mountTechnical('```js\n\tconst x = 1;\n```', { clipboard: async text => { copied.push(text); } });
  try {
    await h.click(technicalButton(h.document, 'Copy code'));
    assert.deepEqual(copied, ['\tconst x = 1;\n']);
    assert.equal(h.document.querySelector('[role="status"]')?.textContent?.includes('copied') === true, true);
  } finally { await h.close(); }
});

test('copy is single-flight and a failure offers an explicit retry', async () => {
  let attempts = 0, reject!: (error: Error) => void;
  const h = await mountTechnical('```text\noriginal\n```', { clipboard: () => {
    attempts++; return attempts === 1 ? new Promise<void>((_resolve, fail) => { reject = fail; }) : Promise.resolve();
  } });
  try {
    const copy = technicalButton(h.document, 'Copy code');
    await h.click(copy); await h.click(copy);
    assert.equal(attempts, 1);
    assert.equal(copy.disabled, true);
    await act(async () => reject(Error('denied')));
    assert.equal(copy.disabled, false);
    assert.equal(h.document.querySelector('[role="status"]')?.textContent?.includes('Could not copy') === true, true);
    await h.click(copy);
    assert.equal(attempts, 2);
    assert.equal(h.document.querySelector('pre code')?.textContent, 'original');
  } finally { await h.close(); }
});

test('syntax coloring begins only on request and leaves code text unchanged', async () => {
  const h = await mountTechnical('```js\nconst x = "<b>"; // note\n```');
  try {
    assert.equal(h.document.querySelectorAll('pre code span').length, 0);
    await h.click(technicalButton(h.document, 'Highlight syntax'));
    assert.equal(h.document.querySelectorAll('pre code span').length > 0, true);
    assert.equal(h.document.querySelector('pre code')?.textContent, 'const x = "<b>"; // note');
    assert.equal(h.document.querySelector('pre b') === null, true);
    await h.click(technicalButton(h.document, 'Plain code'));
    assert.equal(h.document.querySelectorAll('pre code span').length, 0);
  } finally { await h.close(); }
});

test('unknown language keeps plain code and still copies the complete source', async () => {
  const copied: string[] = [];
  const h = await mountTechnical('```future-language\nkeep **literal**\n```', { clipboard: async text => { copied.push(text); } });
  try {
    assert.equal(h.document.querySelector('.markdown-code-language')?.textContent, 'future-language');
    assert.equal([...h.document.querySelectorAll('button')].some(node => node.textContent === 'Highlight syntax' && !node.disabled), false);
    await h.click(technicalButton(h.document, 'Copy code'));
    assert.deepEqual(copied, ['keep **literal**\n']);
    assert.equal(h.document.querySelector('pre strong') === null, true);
  } finally { await h.close(); }
});

test('new code replaces highlighted text and copying uses the latest source', async () => {
  const copied: string[] = [];
  const h = await mountTechnical('```js\nconst old = 1;\n```', { clipboard: async text => { copied.push(text); } });
  try {
    await h.click(technicalButton(h.document, 'Highlight syntax'));
    await h.render(<MarkdownPreview value={'```js\nconst current = 2;\n```'} />);
    assert.equal(h.document.querySelector('pre code')?.textContent, 'const current = 2;');
    assert.equal(h.document.querySelectorAll('pre code span').length, 0);
    await h.click(technicalButton(h.document, 'Copy code'));
    assert.deepEqual(copied, ['const current = 2;\n']);
  } finally { await h.close(); }
});

test('a late clipboard settlement cannot show copied feedback for replacement code', async () => {
  let finish!: () => void;
  const copied: string[] = [];
  const h = await mountTechnical('```js\nconst old = 1;\n```', { clipboard: text => {
    copied.push(text); return copied.length === 1 ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve();
  } });
  try {
    await h.click(technicalButton(h.document, 'Copy code'));
    await h.render(<MarkdownPreview value={'```js\nconst next = 2;\n```'} />);
    assert.equal(technicalButton(h.document, 'Copy code').disabled, true);
    await act(async () => finish());
    assert.equal(h.document.querySelector('[role="status"]')?.textContent, '');
    await h.click(technicalButton(h.document, 'Copy code'));
    assert.deepEqual(copied, ['const old = 1;\n', 'const next = 2;\n']);
  } finally { await h.close(); }
});
