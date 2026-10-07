import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { copy, detail, historyMount, q, waitFor } from './ui/history-dom';

const long = `  ORIGINAL QUESTION\n\n${'😀 文本 '.repeat(80)}\n\n  END  `;
async function open(text: string, props: Record<string, unknown> = {}) {
  const h = await historyMount({ getQuestion: async () => ({ ...detail(), question: { ...q, text } }) }, props);
  await waitFor(() => h.document.querySelector('.question-main'));
  await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
  return h;
}

test('long question collapses by default, expands exact original and copies its whitespace', async () => {
  const h = await open(long); const copied: string[] = [];
  Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  try {
    const expand = h.button(copy.questionExpand);
    assert.ok(expand, 'long original question needs an explicit expand control');
    const heading = h.document.querySelector('.question-reader h2')!;
    assert.notEqual(heading.textContent, long);
    assert.ok([...heading.textContent!].length <= 181);
    await h.click(expand); assert.equal(heading.textContent, long);
    await h.click(h.button(copy.questionCopyPrompt)); assert.deepEqual(copied, [long]);
    await h.click(h.button(copy.questionCollapse)); assert.notEqual(heading.textContent, long);
  } finally { await h.close(); }
});

test('four short lines can be expanded while a normal short question is complete', async () => {
  const h = await open('one\ntwo\nthree\nfour');
  try { assert.ok(h.button(copy.questionExpand), 'multi-line questions also need an expand control'); }
  finally { await h.close(); }
  const short = await open('  short 😀 question  ');
  try { assert.equal(short.document.querySelector('.question-reader h2')!.textContent, '  short 😀 question  '); assert.equal(short.button(copy.questionExpand) === undefined, true); }
  finally { await short.close(); }
});

test('reasking a collapsed question preserves full original and keeps attachment replacement confirmation', async () => {
  const drafts: string[] = [];
  const h = await open(long, { draft: 'current draft', draftImageCount: 1, onDraft: (text: string) => drafts.push(text) });
  try {
    assert.ok(h.button(copy.questionExpand), 'test starts with a collapsed original');
    await h.click(h.button(copy.questionReask));
    assert.ok(h.document.querySelector('[role="dialog"]')); assert.deepEqual(drafts, []);
    await h.click(h.button(copy.cancel)); assert.deepEqual(drafts, []);
    await h.click(h.button(copy.questionReask));
    await act(async () => h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!.click());
    assert.deepEqual(drafts, [long]);
  } finally { await h.close(); }
});
