import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createArchiveRecord, type ArchiveRecord } from '../src/shared/archive';
import type { QuestionArchiveRequest } from '../src/shared/question-archive';
import { a1, a2, b, copy, deferred, detail, historyMount, q, waitFor } from './ui/history-dom';

type Harness = Awaited<ReturnType<typeof historyMount>>;
const record = createArchiveRecord({ text: q.text, task: q.text, results: [{ host: 'claude.ai', label: 'Claude', text: a2.answerMarkdown }] },
  { id: 'organized-question', now: 3000, deviceId: 'fixture' });
async function open(h: Harness) {
  await waitFor(() => h.document.querySelector('.question-main'));
  await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
}
async function organize(h: Harness) {
  const entry = h.button(copy.questionOrganize);
  assert.equal(entry !== undefined, true, 'saved history must expose its own save-to-results action');
  await act(async () => entry.focus());
  await h.click(entry);
  assert.equal(h.document.querySelector('.question-archive-picker [role="dialog"]') !== null, true, 'explicit copy picker opens');
}
const action = (h: Harness, mode: 'read' | 'compare') => h.document.querySelector<HTMLButtonElement>(`[data-question-archive="${mode}"]`)!;
const selector = (h: Harness, site: string) => h.document.querySelector<HTMLSelectElement>(`[data-archive-site="${site}"] select`)!;

test('save current copy submits only its saved identity/version and opens read mode', async () => {
  const requests: QuestionArchiveRequest[] = [], opened: string[] = [];
  const h = await historyMount({ createQuestionArchive: async (request: QuestionArchiveRequest) => { requests.push(request); return record; },
    collectAnswers: () => { throw new Error('history must not collect live pages'); },
    addArchive: () => { throw new Error('renderer must not submit history text'); } },
  { onArchiveCreated: (value: ArchiveRecord, mode: string) => opened.push(`${value.id}:${mode}`) });
  try {
    await open(h); await organize(h);
    assert.equal(selector(h, 'claude').value, a2.id);
    assert.equal(selector(h, 'kimi').value, '', 'other sites require explicit selection');
    assert.equal(action(h, 'compare').disabled, true);
    await h.click(action(h, 'read'));
    assert.deepEqual(requests, [{ questionId: q.id, answers: [{ answerId: a2.id, updatedAt: a2.updatedAt }], locale: 'en' }]);
    assert.deepEqual(opened, [`${record.id}:read`]);
  } finally { await h.close(); }
});

test('explicit old attempt replaces the same-site selection and a second site enables compare', async () => {
  const requests: QuestionArchiveRequest[] = [], modes: string[] = [];
  const h = await historyMount({ createQuestionArchive: async (request: QuestionArchiveRequest) => { requests.push(request); return record; } },
    { onArchiveCreated: (_record: ArchiveRecord, mode: string) => modes.push(mode) });
  try {
    await open(h); await organize(h);
    await h.select(selector(h, 'claude'), a1.id); await h.select(selector(h, 'kimi'), b.id);
    assert.equal(action(h, 'compare').disabled, false);
    await h.click(action(h, 'compare'));
    assert.deepEqual(requests[0].answers, [{ answerId: a1.id, updatedAt: a1.updatedAt }, { answerId: b.id, updatedAt: b.updatedAt }]);
    assert.deepEqual(modes, ['compare']);
  } finally { await h.close(); }
});

test('cancel and IME Escape preserve history, return focus, and never create a snapshot', async () => {
  let writes = 0; const blocking: boolean[] = [];
  const h = await historyMount({ createQuestionArchive: async () => { writes++; return record; } },
    { onBlockingChange: (value: boolean) => blocking.push(value) });
  try {
    await open(h); await organize(h);
    const event = new h.window.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    await act(async () => h.document.activeElement!.dispatchEvent(event));
    assert.equal(event.defaultPrevented, false);
    assert.equal(h.document.querySelector('.question-archive-picker') !== null, true);
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(h.document.querySelector('.question-archive-picker') === null, true);
    assert.equal(h.document.querySelector('.question-reader') !== null, true);
    assert.equal(h.document.activeElement === h.button(copy.questionOrganize), true);
    assert.equal(writes, 0); assert.equal(blocking.at(-1), false);
  } finally { await h.close(); }
});

test('busy, unloaded, and missing copies cannot enter snapshot creation', async () => {
  const pending = deferred<ReturnType<typeof detail>>();
  const h = await historyMount({ getQuestion: async (_id: string, answerId?: string) => answerId ? pending.promise : detail() });
  try {
    await open(h); await h.rerender({ busy: true });
    assert.equal(h.button(copy.questionOrganize) !== undefined, true, 'busy state keeps the action visible');
    assert.equal(h.button(copy.questionOrganize).disabled, true);
    await h.rerender({ busy: false }); await h.click(h.button('Kimi'));
    assert.equal(h.button(copy.questionOrganize).disabled, true, 'loading cannot copy an old saved body');
    await act(async () => pending.resolve({ ...detail(b.id), answers: detail(b.id).answers.map(answer => ({ ...answer, answerMarkdown: null, capturedAt: null })) }));
    assert.equal(h.button(copy.questionOrganize).disabled, true, 'missing body cannot be archived');
  } finally { await h.close(); }
});

test('duplicate click creates once; failure preserves explicit candidates for retry', async () => {
  const pending = deferred<ArchiveRecord>(); let writes = 0;
  const h = await historyMount({ createQuestionArchive: () => { writes++; return writes === 1 ? pending.promise : Promise.resolve(record); } });
  try {
    await open(h); await organize(h); await h.select(selector(h, 'claude'), a1.id);
    const read = action(h, 'read'); await act(async () => { read.click(); read.click(); });
    assert.equal(writes, 1); assert.equal(read.disabled, true);
    await act(async () => pending.reject(new Error('invalid_archive')));
    assert.equal(h.document.querySelector('.question-archive-picker [role="alert"]') !== null, true);
    assert.equal(selector(h, 'claude').value, a1.id);
    await h.click(action(h, 'read')); assert.equal(writes, 2);
  } finally { await h.close(); }
});

test('changed copies require a source refresh and explicit review before retrying', async () => {
  let reads = 0;
  const h = await historyMount({ getQuestion: async () => { reads++; return detail(); },
    createQuestionArchive: async () => { throw new Error('history_not_found'); } });
  try {
    await open(h); await organize(h); await h.select(selector(h, 'claude'), a1.id);
    await h.click(action(h, 'read'));
    assert.match(h.document.querySelector('.question-archive-picker [role="alert"]')!.textContent!, /Selected copies changed/);
    assert.equal(selector(h, 'claude').value, a1.id);
    const refresh = h.document.querySelector<HTMLButtonElement>('[data-question-archive="refresh"]');
    assert.equal(refresh !== null, true, 'changed versions provide a source refresh');
    await h.click(refresh!); assert.equal(reads, 2);
    assert.equal(selector(h, 'claude').value, '', 'refresh requires renewed explicit selection');
    assert.equal(action(h, 'read').disabled, true);
  } finally { await h.close(); }
});

test('departed history or new surface suppresses late creation navigation without undoing writes', async () => {
  for (const departure of ['back', 'closed', 'busy'] as const) {
    const pending = deferred<ArchiveRecord>(); const opened: string[] = [];
    const h = await historyMount({ createQuestionArchive: () => pending.promise },
      { onArchiveCreated: (value: ArchiveRecord) => opened.push(value.id) });
    try {
      await open(h); await organize(h); await h.click(action(h, 'read'));
      if (departure === 'back') await h.click(h.button(copy.questionBack));
      else await h.rerender(departure === 'closed' ? { open: false } : { busy: true });
      await act(async () => pending.resolve(record));
      assert.deepEqual(opened, [], `${departure} must invalidate old navigation intent`);
    } finally { await h.close(); }
  }
});
