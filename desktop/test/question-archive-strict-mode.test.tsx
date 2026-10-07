import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { createArchiveRecord, type ArchiveRecord } from '../src/shared/archive';
import type { QuestionArchiveRequest } from '../src/shared/question-archive';
import { a1, a2, copy, deferred, detail, historyMount, q, waitFor } from './ui/history-dom';

const record = createArchiveRecord({ text: q.text, task: q.text,
  results: [{ host: 'claude.ai', label: 'Claude', text: a2.answerMarkdown }] },
{ id: 'strict-history-result', now: 3000, deviceId: 'fixture' });
type Harness = Awaited<ReturnType<typeof historyMount>>;
async function openPicker(h: Harness) {
  await waitFor(() => h.document.querySelector('.question-main'));
  await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
  await h.click(h.button(copy.questionOrganize));
}
const read = (h: Harness) => h.document.querySelector<HTMLButtonElement>('[data-question-archive="read"]')!;

test('StrictMode effect replay still delivers a deferred saved snapshot and closes its picker', async () => {
  const saved = deferred<ArchiveRecord>(), opened: string[] = [];
  const h = await historyMount({ createQuestionArchive: () => saved.promise },
    { onArchiveCreated: (value: ArchiveRecord, mode: string) => opened.push(`${value.id}:${mode}`) }, { strictMode: true });
  try {
    await openPicker(h); await h.click(read(h));
    assert.equal(read(h).disabled, true);
    await act(async () => saved.resolve(record));
    assert.equal(opened.join(','), `${record.id}:read`, 'mounted StrictMode picker must complete its authorized navigation');
    assert.equal(h.document.querySelector('.question-archive-picker') === null, true);
  } finally { await h.close(); }
});

test('StrictMode failure releases saving and deferred refresh requires a new version selection', async () => {
  const failure = deferred<ArchiveRecord>(), refreshed = deferred<ReturnType<typeof detail>>();
  const requests: QuestionArchiveRequest[] = []; let reads = 0;
  const h = await historyMount({ getQuestion: () => ++reads === 1 ? Promise.resolve(detail()) : refreshed.promise,
    createQuestionArchive: (request: QuestionArchiveRequest) => { requests.push(request); return requests.length === 1 ? failure.promise : Promise.resolve(record); } },
  {}, { strictMode: true });
  try {
    await openPicker(h); await h.click(read(h));
    await act(async () => failure.reject(new Error('history_not_found')));
    assert.equal(h.document.querySelector('.question-archive-picker [role="alert"]') !== null, true,
      'StrictMode mounted failure must release saving and offer source refresh');
    const refresh = h.document.querySelector<HTMLButtonElement>('[data-question-archive="refresh"]')!;
    assert.equal(refresh.disabled, false); await h.click(refresh);
    assert.equal(read(h).disabled, true);
    const next = { ...detail(), answers: detail().answers.map(answer => ({ ...answer, updatedAt: answer.updatedAt + 1 })) };
    await act(async () => refreshed.resolve(next));
    const select = h.document.querySelector<HTMLSelectElement>('[data-archive-site="claude"] select')!;
    assert.equal(select.value, '', 'refreshed versions are never selected automatically');
    assert.equal(select.disabled, false); await h.select(select, a1.id); await h.click(read(h));
    assert.equal(requests.at(-1)?.answers[0]?.answerId, a1.id);
    assert.equal(requests.at(-1)?.answers[0]?.updatedAt, a1.updatedAt + 1);
  } finally { await h.close(); }
});
