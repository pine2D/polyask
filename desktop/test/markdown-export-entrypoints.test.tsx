import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { copy, q, a1, a2, b, historyMount, waitFor } from './ui/history-dom';
import { entry, documentFixture } from './markdown-export-fixtures';
import type { MarkdownExportRequest, MarkdownPreviewRequest } from '../src/shared/markdown-export';
import { ArchiveSurface } from '../src/renderer/archive-surface';
import { setShellApi } from '../src/renderer/shell-api';
import { withFolderPages } from './ui/library-page-api';
import { mountLibrary, record, decision, waitForInitial, workspace } from './ui/library-test-host';
const historyDoc = documentFixture(q.id, [entry(a1.id, 'claude', { attempt: 1 }), entry(a2.id, 'claude', { attempt: 2 }), entry(b.id, 'kimi', { attempt: 1 })]);

test('history exports the displayed attempt and returning from a whole-record panel preserves reading position', async () => {
  const saved: MarkdownExportRequest[] = [], previews: MarkdownPreviewRequest[] = [];
  const h = await historyMount({ previewMarkdown: async (r: MarkdownPreviewRequest) => { previews.push(r); return [historyDoc]; },
    exportMarkdown: async (r: MarkdownExportRequest) => { saved.push(r); return { status: 'saved' }; } });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    await h.select(h.document.querySelector<HTMLSelectElement>('.question-answer-meta select')!, a1.id);
    const reader = h.document.querySelector<HTMLElement>('.question-reader')!; reader.scrollTop = 133;
    const one = h.button(copy.markdownSingle); assert.equal(one !== undefined, true, 'displayed answer offers .md download');
    await h.click(one); assert.deepEqual(saved[0].selections[0].entryIds, [a1.id]);
    await h.click(h.button(copy.questionMenu)); await h.click(h.button(copy.markdownWhole));
    assert.deepEqual(previews.at(-1)?.targets, [{ kind: 'history', id: q.id }]);
    await h.click(h.button(copy.cancel));
    assert.equal(h.document.querySelector('.question-reader') === reader, true);
    assert.equal(reader.scrollTop, 133); assert.equal(h.document.querySelector<HTMLSelectElement>('.question-answer-meta select')!.value, a1.id);
  } finally { await h.close(); }
});

test('history keeps hidden selections through search, excludes later loaded items and clears on exit', async () => {
  const next = { ...q, id: 'q-next', text: 'Next question' }, previews: MarkdownPreviewRequest[] = [];
  const summary = (value: typeof q) => ({ ...value, savedSites: 1, answers: [a1] });
  const h = await historyMount({ listQuestions: async ({ query, cursor }: any) => ({ items: query ? [summary(next)] : cursor ? [summary(next)] : [summary(q)], cursor: query || cursor ? null : 'more' }),
    previewMarkdown: async (r: MarkdownPreviewRequest) => { previews.push(r); return [historyDoc]; } });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    assert.equal(h.button(copy.markdownSelect) !== undefined, true, 'history exposes explicit selection mode');
    await h.click(h.button(copy.markdownSelect));
    await h.click(h.document.querySelector<HTMLInputElement>('.question-card-select')!);
    await h.click(h.button(copy.questionMore));
    assert.equal(h.document.querySelectorAll('.question-card-select:checked').length, 1);
    await h.input(h.document.querySelector<HTMLInputElement>('.question-search input')!, 'Next');
    await waitFor(() => h.document.querySelectorAll('.question-card-select').length === 1 && h.document.querySelector('.question-title')?.textContent === 'Next question');
    assert.equal(h.document.querySelector('.question-selection')?.textContent?.includes('1 outside the current results'), true);
    await h.click(h.button(copy.markdownMerge));
    assert.deepEqual(previews[0].targets, [{ kind: 'history', id: q.id }]);
    await h.click(h.button(copy.cancel)); await h.click(h.button(copy.markdownFinish));
    assert.equal(h.document.querySelector('.question-selection') === null, true);
    await h.click(h.button(copy.markdownSelect));
    assert.equal(h.document.querySelectorAll('.question-card-select:checked').length, 0);
  } finally { await h.close(); }
});

test('library exports the displayed answer and the whole record through distinct visible controls', async () => {
  const saved: MarkdownExportRequest[] = [], previews: MarkdownPreviewRequest[] = [];
  const doc = documentFixture(record.id, [entry('result:0', 'claude')], { target: { kind: 'archive', id: record.id }, revision: 'v1', updatedAt: record.updatedAt });
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], searchFolderContents: async () => [{ kind: 'archive', record }], getArchive: async () => record,
    previewMarkdown: async (r: MarkdownPreviewRequest) => { previews.push(r); return [doc]; }, exportMarkdown: async (r: MarkdownExportRequest) => { saved.push(r); return { status: 'saved' }; }
  }) as any);
  const h = await mountLibrary(<ArchiveSurface copy={copy} locale="en" preferredId={record.id} onClose={() => {}} onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null}
    pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} />);
  try {
    await waitForInitial();
    const one = h.document.querySelector<HTMLButtonElement>('[data-action="archive-answer-export"]');
    assert.equal(one !== null, true); await h.click(one!);
    assert.deepEqual(saved[0].selections[0].entryIds, ['result:0']);
    const pane = h.document.querySelector<HTMLElement>('.archive-detail-pane')!; pane.scrollTop = 88;
    const whole = h.document.querySelector<HTMLButtonElement>('[data-action="archive-markdown-export"]')!;
    await act(async () => whole.focus()); await h.click(whole);
    assert.deepEqual(previews.at(-1)?.targets, [{ kind: 'archive', id: record.id }]);
    await h.click(h.document.querySelector<HTMLButtonElement>('[role="dialog"] header button')!);
    assert.equal(h.document.querySelector('.archive-detail-pane') === pane, true); assert.equal(pane.scrollTop, 88);
    assert.equal(h.document.activeElement === whole, true);
  } finally { await h.close(); setShellApi(null); }
});

test('library bulk opens one source picker for selected records and saved decision cards', async () => {
  const previews: MarkdownPreviewRequest[] = [];
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], searchFolderContents: async () => [{ kind: 'archive', record }, { kind: 'decision', record: decision }],
    previewMarkdown: async (r: MarkdownPreviewRequest) => { previews.push(r); return r.targets.map(t => documentFixture(t.id, [entry(t.kind === 'decision' ? 'decision' : 'result:0', t.kind === 'decision' ? '__decision' : 'claude', { kind: t.kind === 'decision' ? 'decision' : 'answer' })], { target: t, revision: 'v1' })); }
  }) as any);
  const h = await mountLibrary(workspace({ preferredId: null }));
  try {
    await waitForInitial(); await h.click(h.document.querySelector<HTMLElement>('[data-action="library-select-page"]')!);
    await h.click(h.document.querySelector<HTMLElement>('[data-action="library-bulk-export"]')!);
    assert.equal(previews.length, 1);
    assert.deepEqual(previews[0].targets.map(t => t.kind).sort(), ['archive', 'decision']);
    assert.equal(h.document.querySelectorAll('.markdown-export-record').length, 2);
    await h.click(h.document.querySelector<HTMLButtonElement>('[role="dialog"] header button')!);
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 2);
  } finally { await h.close(); setShellApi(null); }
});

test('history selection stops at 100, clears on close, and never expands to all search results', async () => {
  const summaries = Array.from({ length: 101 }, (_, index) => ({ ...q, id: `limit-${index}`, text: `Question ${index}`, savedSites: 1, answers: [a1] }));
  const h = await historyMount({ listQuestions: async ({ cursor }: any) => ({ items: cursor ? summaries.slice(100) : summaries.slice(0, 100), cursor: cursor ? null : 'last' }) });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.button(copy.markdownSelect));
    await h.click(h.document.querySelector<HTMLInputElement>('.question-selection input')!);
    assert.equal(h.document.querySelectorAll('.question-card-select:checked').length, 100);
    await h.click(h.button(copy.questionMore));
    await h.click(h.document.querySelectorAll<HTMLInputElement>('.question-card-select')[100]);
    assert.equal(h.document.querySelectorAll('.question-card-select:checked').length, 100);
    await h.rerender({ open: false }); await h.rerender({ open: true });
    await waitFor(() => h.button(copy.markdownSelect)); await h.click(h.button(copy.markdownSelect));
    assert.equal(h.document.querySelectorAll('.question-card-select:checked').length, 0);
  } finally { await h.close(); }
});
