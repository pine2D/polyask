import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { SITES } from '../src/main/sites';
import { getCopy } from '../src/shared/copy';
import { createArchiveRecord, type ArchiveRecord } from '../src/shared/archive';
import { mountDom } from './ui/dom-harness';
import type { SynthesisDraft } from '../src/renderer/synthesis-draft';

const copy = getCopy('en');
const record = createArchiveRecord({ text: 'Original question', task: 'Display title', results: [
  { host: 'claude.ai', label: 'Claude ' + 'long source label '.repeat(12), text: 'First answer.\n\nFull final tail 😀', code: 'answer_truncated' },
  { host: 'chatgpt.com', label: 'ChatGPT', text: 'Second answer.\r\n  Keep spaces and line endings.  ' },
  { host: 'www.kimi.com', label: 'Kimi', text: null, code: 'no_answer' }
] }, { id: 'preview-source', now: 100, deviceId: 'fixture' });
const draft: SynthesisDraft & { sourceChanged: boolean } = { selectedHosts: ['claude.ai', 'chatgpt.com'],
  targetSite: 'kimi', tier: 'think', instruction: 'Compare carefully 😀', excerpt: '', sourceChanged: false };
const noop = () => {};
const view = (source: ArchiveRecord = record, initialDraft: typeof draft | null = draft, busy = false, followUpHost?: string,
  onSend: (request: unknown) => void = noop) => <SynthesisWorkspace copy={copy} record={source} sites={SITES} defaultTier={null}
    busy={busy} initialDraft={initialDraft} followUpHost={followUpHost} onCancel={noop} onSend={onSend} />;
const preview = (doc: Document) => doc.querySelector<HTMLTextAreaElement>('[name=synthesis-preview]')!;
// textarea.value 是浏览器的 LF 显示投影；原始 CRLF 另通过完整复制契约核对。
const displayedBody = (value: string) => value.replace(/\r\n?/g, '\n');

test('configuration starts with a useful summary and the complete payload is initially collapsed', async () => {
  let sends = 0;
  const h = await mountDom(view(record, null, false, undefined, () => { sends++; }));
  try {
    const panel = h.document.querySelector<HTMLDetailsElement>('details.synthesis-preview');
    assert.equal(!!panel, true, 'complete payload is an on-demand native disclosure');
    assert.equal(panel!.open, false);
    const summary = h.document.querySelector('[data-synthesis-summary]')?.textContent ?? '';
    assert.equal(summary.includes('2'), true); assert.equal(summary.includes(copy.synthesisTargetMissing), true);
    assert.equal(summary.includes('new conversation'), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true);
    assert.equal(sends, 0);
    assert.equal(preview(h.document).value.includes(record.results[0].text!), true, 'collapsed contents retain the complete saved body');
    assert.equal(preview(h.document).value.includes(displayedBody(record.results[1].text!)), true);
  } finally { await h.close(); }
});

test('opening and closing complete contents retains every field and reveals the full saved text and source IDs', async () => {
  const h = await mountDom(view());
  try {
    const panel = h.document.querySelector<HTMLDetailsElement>('details.synthesis-preview');
    assert.equal(!!panel, true, 'complete payload is an on-demand native disclosure');
    const summary = h.document.querySelector('[data-synthesis-summary]')?.textContent ?? '';
    assert.equal(summary.includes('Kimi'), true); assert.equal(summary.includes(copy.think), true);
    await h.click(panel!.querySelector<HTMLElement>('summary')!);
    assert.equal(panel!.open, true);
    const full = preview(h.document).value;
    assert.equal(full.includes('Source [S1]: captured text is truncated'), true);
    assert.equal(full.includes('Source [S2]: completeness not verified'), true);
    assert.equal(full.includes(displayedBody(record.results[1].text!)), true);
    assert.equal(full.endsWith('# Synthesis request\n' + draft.instruction), true);
    await h.click(panel!.querySelector<HTMLElement>('summary')!);
    assert.equal(panel!.open, false);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=synthesis-instruction]')!.value, draft.instruction);
    assert.equal(h.document.querySelector('[name=synthesis-target]')!.textContent?.includes('Kimi'), true);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name=synthesis-answer]')!.checked, true);
    assert.equal(preview(h.document).value === full, true);
  } finally { await h.close(); }
});

test('unrelated busy rerenders preserve the exact preview marker while requirement edits rebuild complete contents', async () => {
  const h = await mountDom(view());
  try {
    const full = preview(h.document).value;
    await h.render(view(record, draft, true));
    assert.equal(preview(h.document).value === full, true, 'reading or busy state does not silently replace a preview fence');
    await h.render(view());
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=synthesis-instruction]')!, 'New requirement with exact tail 😀');
    assert.equal(preview(h.document).value.endsWith('# Synthesis request\nNew requirement with exact tail 😀'), true);
    assert.equal(preview(h.document).value.includes(displayedBody(record.results[1].text!)), true);
  } finally { await h.close(); }
});

test('changing the selected subset updates the summary without renumbering sources or enabling an invalid send', async () => {
  const h = await mountDom(view());
  try {
    await h.click(h.document.querySelector<HTMLInputElement>('[name=synthesis-answer]')!);
    assert.equal(h.document.querySelector('[data-synthesis-summary]')?.textContent?.includes('1'), true, 'summary reflects the chosen source count');
    assert.equal(preview(h.document).value.includes('Source [S1]:'), false);
    assert.equal(preview(h.document).value.includes('Source [S2]:'), true);
    assert.equal(preview(h.document).value.includes(displayedBody(record.results[1].text!)), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true);
  } finally { await h.close(); }
});

test('copying complete contents preserves original CRLF and spaces rather than the textarea display projection', async () => {
  const h = await mountDom(view()); let copied = '';
  Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  try {
    const panel = h.document.querySelector<HTMLDetailsElement>('details.synthesis-preview')!;
    await h.click(panel.querySelector<HTMLElement>('summary')!);
    const button = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === copy.synthesisCopyPayload);
    assert.equal(!!button, true); await h.click(button!);
    assert.equal(copied.includes(record.results[1].text!), true, 'clipboard retains exact saved line endings and trailing spaces');
    assert.equal(copied.endsWith('# Synthesis request\n' + draft.instruction), true);
    assert.equal(displayedBody(copied) === preview(h.document).value, true);
    assert.equal(panel.querySelector('[role=status]')!.textContent, copy.synthesisPayloadCopied);
  } finally { await h.close(); }
});

test('oversized complete payload remains available for inspection and is never silently shortened', async () => {
  const huge = '😀'.repeat(60000) + 'FULL END';
  const source = { ...record, results: [{ ...record.results[0], text: huge }, record.results[1]] };
  const h = await mountDom(view(source));
  try {
    assert.equal(!!h.document.querySelector('details.synthesis-preview'), true, 'oversized full contents remain on demand');
    assert.equal(preview(h.document).value.includes(huge), true);
    assert.equal([...preview(h.document).value].length > 60000, true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, true);
    assert.equal(h.document.querySelector('footer [role=status]')!.textContent, copy.synthesisTooLong);
  } finally { await h.close(); }
});

test('progressive preview retains a follow-up excerpt over the decision evidence limit when its full payload is valid', async () => {
  const excerpt = 'x'.repeat(4001) + '😀';
  const source = { ...record, results: [{ ...record.results[0], text: 'Before\n' + excerpt + '\nAfter' }, record.results[1]] };
  const initial = { ...draft, selectedHosts: ['claude.ai'], instruction: 'Why this exact statement?', excerpt };
  const h = await mountDom(view(source, initial, false, 'claude.ai'));
  try {
    assert.equal(!!h.document.querySelector('details.synthesis-preview'), true, 'follow-up also exposes its complete payload on demand');
    assert.equal(preview(h.document).value.includes(excerpt), true);
    assert.equal(preview(h.document).value.includes('Before\n'), false);
    assert.equal(preview(h.document).value.includes('Source [S1]:'), true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('footer button')!.disabled, false);
  } finally { await h.close(); }
});
