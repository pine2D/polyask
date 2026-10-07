import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ArchiveDetail } from '../src/renderer/archive-detail';
import { createArchiveRecord } from '../src/shared/archive';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');
const body = 'Header\r\n  Exact 😀 phrase.  \r\nTail';
const record = createArchiveRecord({ task: 'Saved source question', text: 'Complete original question', results: [
  { host: 'claude.ai', label: 'Claude', text: null },
  { host: 'chatgpt.com', label: 'ChatGPT', text: body, code: 'answer_truncated' },
  { host: 'www.kimi.com', label: 'Kimi', text: '**Bold** bridge and repeat.\n\nrepeat.' }
] }, { id: 'excerpt-source', now: 100, deviceId: 'fixture' });

async function setup() {
  const follows: unknown[][] = [], evidence: unknown[][] = [];
  const props = { copy, locale: 'en', record, busy: false, pendingSynthesis: null, synthesisCandidate: null,
    onPatch: () => {}, onOpenSource: () => {}, onSynthesize: () => {}, onCollectSynthesis: () => {}, onSaveSynthesis: () => {},
    onFollowUp: (...args: unknown[]) => { follows.push(args); }, onCreateDecision: (...args: unknown[]) => { evidence.push(args); } };
  const h = await mountDom(<ArchiveDetail {...props} />);
  const button = (label: string, parent: ParentNode = h.document) => [...parent.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);
  const raw = async (index = 1) => {
    const open = button('Select original excerpt', h.document.querySelector(`#archive-answer-${index}`)!);
    assert.equal(!!open, true, 'saved answer exposes a keyboard-accessible original excerpt action');
    await h.click(open!);
    const textarea = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]');
    assert.equal(!!textarea, true); return textarea!;
  };
  const selectRaw = async (textarea: HTMLTextAreaElement, start: number, end: number) => {
    await act(async () => { textarea.focus(); textarea.setSelectionRange(start, end);
      h.document.dispatchEvent(new h.window.Event('selectionchange')); });
  };
  const selectRendered = async (node: HTMLElement, start: number, end: number) => {
    const selected = node.textContent!.slice(start, end);
    const walker = h.document.createTreeWalker(node, 4);
    let text = walker.nextNode() as Text | null;
    while (text && !text.data.includes(selected)) text = walker.nextNode() as Text | null;
    assert.equal(!!text, true, 'plain selection belongs to one real text node');
    await act(async () => { const range = h.document.createRange(), offset = text!.data.indexOf(selected);
      range.setStart(text!, offset); range.setEnd(text!, offset + selected.length);
      const selection = h.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new h.window.Event('pointerup', { bubbles: true })); });
  };
  return { ...h, props, button, raw, selectRaw, selectRendered, follows, evidence };
}

test('original excerpt confirms the literal CRLF, spaces and emoji range with the original source number', async () => {
  const h = await setup(); try {
    const textarea = await h.raw(); assert.equal(textarea.value === body.replace(/\r\n/g, '\n'), true); assert.equal(textarea.readOnly, true);
    const start = body.indexOf('  Exact'), end = body.indexOf('\r\nTail');
    await h.selectRaw(textarea, textarea.value.indexOf('  Exact'), textarea.value.indexOf('\nTail'));
    const confirm = h.button('Use this excerpt'); assert.equal(!!confirm && !confirm.disabled, true); await h.click(confirm!);
    assert.equal(h.document.querySelector('.answer-excerpt-actions')?.textContent?.includes('[S2] ChatGPT'), true);
    assert.equal(h.document.querySelector('.answer-excerpt-actions')?.textContent?.includes(copy.answerTruncated), true);
    await h.click(h.button('Follow up on excerpt')!);
    assert.equal(h.follows.length, 1); assert.equal(h.follows[0][0], 'chatgpt.com');
    const excerpt = h.follows[0][1] as Record<string, unknown>;
    assert.equal(excerpt.archiveId, record.id); assert.equal(excerpt.sourceUpdatedAt, record.updatedAt);
    assert.equal(excerpt.resultIndex, 1); assert.equal(excerpt.start, start); assert.equal(excerpt.end, end);
    assert.equal(excerpt.excerpt === body.slice(start, end), true);
  } finally { await h.close(); }
});

test('a unique plain rendered selection can become evidence without selecting the complete answer', async () => {
  const h = await setup(); try {
    const paragraph = h.document.querySelector<HTMLElement>('#archive-answer-1 .markdown-preview p')!;
    assert.equal(!!h.button('Select original excerpt'), true, 'excerpt controls are available');
    const text = paragraph.textContent!, start = text.indexOf('Exact');
    await h.selectRendered(paragraph, start, start + 'Exact 😀 phrase.'.length);
    const action = h.button('Use as evidence'); assert.equal(!!action, true); await h.click(action!);
    assert.equal(h.evidence.length, 1);
    const excerpt = h.evidence[0][0] as Record<string, unknown>;
    assert.equal(excerpt.resultIndex, 1); assert.equal(excerpt.excerpt, 'Exact 😀 phrase.');
    assert.equal(excerpt.start, body.indexOf('Exact')); assert.equal(excerpt.end, body.indexOf('Exact') + 'Exact 😀 phrase.'.length);
  } finally { await h.close(); }
});

test('repeated rendered text asks for original range confirmation instead of guessing its first occurrence', async () => {
  const h = await setup(); try {
    assert.equal(!!h.button('Select original excerpt'), true);
    const paragraph = h.document.querySelectorAll<HTMLElement>('#archive-answer-2 .markdown-preview p')[1];
    await h.selectRendered(paragraph, 0, 'repeat.'.length);
    assert.equal(!!h.document.querySelector('[name=answer-excerpt-original]'), true);
    assert.equal(h.follows.length + h.evidence.length, 0);
    assert.equal(!!h.button('Use this excerpt') && h.button('Use this excerpt')!.disabled, true);
  } finally { await h.close(); }
});

test('formatted cross-node selection falls back to saved Markdown and cancel has no action', async () => {
  const h = await setup(); try {
    assert.equal(!!h.button('Select original excerpt'), true);
    const paragraph = h.document.querySelector<HTMLElement>('#archive-answer-2 .markdown-preview p')!;
    await act(async () => { const range = h.document.createRange(); range.selectNodeContents(paragraph);
      h.window.getSelection()!.removeAllRanges(); h.window.getSelection()!.addRange(range);
      paragraph.dispatchEvent(new h.window.Event('pointerup', { bubbles: true })); });
    const textarea = h.document.querySelector<HTMLTextAreaElement>('[name=answer-excerpt-original]');
    assert.equal(!!textarea, true); assert.equal(textarea!.value === record.results[2].text, true);
    await h.click(h.button(copy.cancel, h.document.querySelector('[role=dialog]')!)!);
    assert.equal(!!h.document.querySelector('[role=dialog]'), false); assert.equal(h.follows.length + h.evidence.length, 0);
  } finally { await h.close(); }
});

test('an empty range or one splitting an emoji cannot be confirmed as a source excerpt', async () => {
  const h = await setup(); try {
    const textarea = await h.raw(); assert.equal(h.button('Use this excerpt')!.disabled, true);
    const emoji = textarea.value.indexOf('😀'); await h.selectRaw(textarea, emoji + 1, emoji + 2);
    assert.equal(h.button('Use this excerpt')!.disabled, true); assert.equal(h.evidence.length + h.follows.length, 0);
  } finally { await h.close(); }
});

test('changing a saved source invalidates the old selected range without applying it to replacement text', async () => {
  const h = await setup(); try {
    const textarea = await h.raw(); await h.selectRaw(textarea, textarea.value.indexOf('Exact'), textarea.value.indexOf('Exact') + 5);
    await h.click(h.button('Use this excerpt')!);
    await h.render(<ArchiveDetail {...h.props} record={{ ...record, updatedAt: 101, results: record.results.map((source, index) =>
      index === 1 ? { ...source, text: 'Replacement Exact body.' } : source) }} />);
    assert.equal(!!h.button('Follow up on excerpt'), false); assert.equal(h.evidence.length + h.follows.length, 0);
  } finally { await h.close(); }
});
