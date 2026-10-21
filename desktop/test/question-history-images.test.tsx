import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { QuestionAttachments } from '../src/renderer/question-attachments';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { copy, deferred, detail, historyMount, q, waitFor } from './ui/history-dom';
import { originals, imageManifest } from './lib/history-image-fixtures';

const question = { ...q, inputImageCount: 4 };
const saved = { questionId: q.id, text: q.text, images: originals };
const api = { listQuestions: async () => ({ items: [{ ...question, savedSites: 0, answers: [] }], cursor: null }),
  getQuestion: async () => ({ ...detail(), question }), questionAttachments: async () => imageManifest(q.id),
  questionAttachment: async ({ index }: { index: number }) => originals[index], questionReask: async () => saved };

test('history reask restores all four original images in order without sending', async () => {
  const applied: {text: string; names: string[]}[] = []; let sends = 0;
  const h = await historyMount({ ...api, broadcast: () => sends++ }, {
    onDraft: (text: string, images: typeof originals = []) => applied.push({ text, names: images.map(i => i.name) }) });
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.button(copy.questionReask));
    assert.deepEqual(applied, [{ text: q.text, names: originals.map(i => i.name) }]);
    assert.equal(sends, 0);
  } finally { await h.close(); }
});

test('reader loads ordered thumbnails from metadata and exposes explicit zoom and close', async () => {
  const h = await historyMount(api);
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(h.document.querySelectorAll('.question-attachments img').length, 4, 'four originals are visible');
    assert.deepEqual([...h.document.querySelectorAll('.question-attachments img')].map(i => i.getAttribute('alt')), originals.map(i => i.name));
    const zoom = h.document.querySelector<HTMLButtonElement>('.question-attachments button[data-image-index="2"]')!;
    assert.equal(!!zoom?.getAttribute('aria-label'), true);
    await h.click(zoom);
    assert.equal(h.document.querySelectorAll('.question-image-dialog img').length, 1);
    await h.click(h.document.querySelector<HTMLButtonElement>('.question-image-dialog button')!);
    assert.equal(h.document.querySelector('.question-image-dialog') === null, true);
    assert.equal(h.document.activeElement === zoom, true);
  } finally { await h.close(); }
});

test('typing while original bytes are pending preserves the newer draft', async () => {
  const response = deferred<typeof saved>(); let revision = 0, applied = 0;
  const h = await historyMount({ ...api, questionReask: () => response.promise }, {
    draftIntent: () => String(revision), onDraft: () => applied++ });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.button(copy.questionReask));
    revision++;
    await h.rerender({ draft: 'newer text' });
    await act(async () => response.resolve(saved));
    assert.equal(applied, 0, 'late originals never overwrite typing');
  } finally { await h.close(); }
});


test('opening delete confirmation invalidates pending reask before deletion is confirmed', async () => {
  const response = deferred<typeof saved>(); let applied = 0;
  const h = await historyMount({ ...api, questionReask: () => response.promise }, { onDraft: () => applied++ });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.button(copy.questionReask));
    await h.click(h.button(copy.questionDelete));
    await act(async () => response.resolve(saved));
    assert.equal(applied, 0, 'the delete intent invalidates the earlier restore');
    assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
  } finally { await h.close(); }
});

test('metadata is read before bytes and no more than two original reads start concurrently', async () => {
  const metadata = deferred<ReturnType<typeof imageManifest>>(), bytes = originals.map(() => deferred<typeof originals[number]>());
  const indices: number[] = []; let active = 0, peak = 0;
  const h = await historyMount({ ...api, questionAttachments: () => metadata.promise,
    questionAttachment: ({ index }: { index: number }) => { indices.push(index); active++; peak = Math.max(peak, active); return bytes[index].promise.finally(() => active--); } });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(indices.length, 0, 'summary count cannot trigger unverified original reads');
    await act(async () => metadata.resolve(imageManifest(q.id))); assert.deepEqual(indices, [0, 1]);
    await act(async () => bytes[1].resolve(originals[1])); assert.deepEqual(indices, [0, 1, 2]);
    await act(async () => bytes[0].resolve(originals[0])); assert.deepEqual(indices, [0, 1, 2, 3]);
    await act(async () => { bytes[2].resolve(originals[2]); bytes[3].resolve(originals[3]); });
    assert.equal(peak, 2); assert.equal(h.document.querySelectorAll('.question-attachments img').length, 4);
  } finally { await h.close(); }
});


test('missing metadata has no private image URL and retries when originals arrive later', async () => {
  let available = false, reads = 0;
  const h = await historyMount({ ...api, questionAttachments: async () => available ? imageManifest(q.id) : null,
    questionAttachment: async ({ index }: { index: number }) => { reads++; return originals[index]; } });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(reads, 0); assert.equal(h.document.querySelectorAll('.question-attachments img').length, 0);
    assert.equal(h.document.querySelector('.question-attachments')!.textContent!.includes(copy.questionOriginalsMissing), true);
    available = true; await h.click(h.button(copy.questionRetry));
    assert.equal(reads, 4); assert.equal(h.document.querySelectorAll('.question-attachments img').length, 4);
    assert.equal([...h.document.querySelectorAll('.question-attachments img')].every(i => i.getAttribute('src')!.startsWith('data:image/png;base64,')), true);
  } finally { await h.close(); }
});

test('leaving the reader stops queued image reads and ignores late metadata or bytes', async () => {
  const bytes = deferred<typeof originals[number]>(); let reads = 0;
  const h = await historyMount({ ...api, questionAttachment: () => { reads++; return bytes.promise; } });
  try {
    await waitFor(() => h.document.querySelector('.question-main')); await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    assert.equal(reads, 2); await h.click(h.button(copy.questionBack));
    await act(async () => bytes.resolve(originals[0]));
    assert.equal(reads, 2, 'unmounted reader does not fetch remaining originals');
    assert.equal(h.document.querySelector('.question-attachments') === null, true);
  } finally { await h.close(); }
});


test('image decode failure and Retry remain visible after outstanding original reads finish', async () => {
  const pending = originals.map(() => deferred<typeof originals[number]>());
  setShellApi({ questionAttachments: async () => imageManifest('q-race'),
    questionAttachment: ({ index }: { index: number }) => pending[index].promise } as any);
  const h = await mountDom(<QuestionAttachments questionId="q-race" inputImageCount={4} copy={copy} />);
  try {
    await act(async () => pending[0].resolve(originals[0]));
    const first = h.document.querySelector('img')!;
    await act(async () => first.dispatchEvent(new h.window.Event('error')));
    assert.equal(h.document.querySelector('[role="alert"]') !== null, true, 'decode error initially reports failure');
    await act(async () => { pending[1].resolve(originals[1]); pending[2].resolve(originals[2]); });
    await act(async () => pending[3].resolve(originals[3]));
    assert.equal(h.document.querySelectorAll('img').length, 3);
    assert.equal(h.document.querySelector('[role="alert"]') !== null, true, 'remaining reads must not erase the decode failure');
    assert.equal([...h.document.querySelectorAll('button')].some(button => button.textContent === copy.questionRetry), true,
      'decode failure retains the explicit Retry action');
  } finally { await h.close(); setShellApi(null); }
});

test('an old image decode error cannot contaminate a successful retry or another question', async () => {
  for (const change of ['retry', 'question']) {
    setShellApi({ questionAttachments: async (id: string) => imageManifest(id),
      questionAttachment: async ({ index }: { index: number }) => originals[index] } as any);
    const h = await mountDom(<QuestionAttachments questionId="q-old" inputImageCount={4} copy={copy} />);
    try {
      const oldImage = h.document.querySelector('img')!;
      if (change === 'retry') {
        await act(async () => h.document.querySelectorAll('img')[3].dispatchEvent(new h.window.Event('error')));
        const retry = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.questionRetry)!;
        await h.click(retry);
      } else await h.render(<QuestionAttachments questionId="q-new" inputImageCount={4} copy={copy} />);
      assert.equal(h.document.querySelectorAll('img').length, 4);
      assert.equal(h.document.querySelector('[role="alert"]') === null, true);
      await act(async () => oldImage.dispatchEvent(new h.window.Event('error')));
      assert.equal(h.document.querySelectorAll('img').length, 4, 'stale image error cannot remove a current thumbnail');
      assert.equal(h.document.querySelector('[role="alert"]') === null, true, 'stale decode failure belongs to its original attempt');
    } finally { await h.close(); setShellApi(null); }
  }
});
