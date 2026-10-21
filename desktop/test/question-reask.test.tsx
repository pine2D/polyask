import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useRef, useState } from 'react';
import { useQuestionReask } from '../src/renderer/use-question-reask';
import { useImageSelection } from '../src/renderer/use-image-selection';
import { DraftRevision } from '../src/renderer/prompt-draft';
import { getCopy } from '../src/shared/copy';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { deferred } from './ui/history-dom';
import { originals } from './lib/history-image-fixtures';
import type { QuestionReask } from '../src/shared/question-attachments';
const copy = getCopy('en');
const restored: QuestionReask = { questionId: 'q-a', text: 'original question', images: originals };

async function fixture(api: Record<string, unknown> = {}, initial = '') {
  let flow!: ReturnType<typeof useQuestionReask>, selection!: ReturnType<typeof useImageSelection>, revision!: DraftRevision;
  let edit!: (text: string) => void, draft = '', applied = 0, done = 0;
  const flags = { open: true, active: true, busy: false };
  function Fixture() {
    const [text, setText] = useState(initial); draft = text;
    revision = useRef(new DraftRevision()).current;
    edit = value => { revision.edit(); setText(value); };
    selection = useImageSelection(copy, true, () => {});
    flow = useQuestionReask({ ...flags, copy, draft: text, draftImageCount: selection.images.length,
      draftIntent: () => `${revision.current}:${selection.intent()}`, imageSyncEnabled: false,
      onDraft: (value, images) => { applied++; selection.replace(images); edit(value); }, onDone: () => done++ });
    return <>{flow.feedback}<span>{text}</span></>;
  }
  let sends = 0;
  setShellApi({ questionReask: async () => restored, getQuestion: async () => ({ question: { id: 'q-a', text: restored.text } }),
    broadcast: () => sends++, ...api } as any);
  const h = await mountDom(<Fixture />);
  return { ...h, flow: () => flow, selection: () => selection, draft: () => draft, applied: () => applied, done: () => done, sends: () => sends,
    edit, flags, revision: () => revision,
    start: async (id = 'q-a') => { await act(async () => flow.start({ id, text: restored.text, imageCount: 4 })); },
    button: (label: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!,
    rerender: () => h.render(<Fixture />),
    close: async () => { await h.close(); setShellApi(null); } };
}

test('missing or corrupt original set preserves text and images until explicit text-only confirmation', async () => {
  for (const error of ['question_attachments_unavailable', 'invalid_question_attachments']) {
    const h = await fixture({ questionReask: async () => { throw new Error(error); } }, 'unsent draft');
    try {
      await act(async () => h.selection().replace([originals[0]]));
      await h.start(); assert.equal(h.applied(), 0); assert.equal(h.draft(), 'unsent draft'); assert.equal(h.selection().images.length, 1);
      assert.equal(h.document.querySelector('[role="alert"]') !== null, true);
      await h.click(h.button(copy.questionOriginalTextOnly));
      assert.equal(h.applied(), 0, 'text only is a deliberate separately confirmed fallback');
      await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
      assert.equal(h.draft(), restored.text); assert.equal(h.selection().images.length, 0); assert.equal(h.sends(), 0);
    } finally { await h.close(); }
  }
});

test('dirty text or images require confirmation even with the same saved text', async () => {
  for (const withImage of [false, true]) {
    const h = await fixture({}, withImage ? '' : restored.text);
    try {
      if (withImage) await act(async () => h.selection().replace([originals[0]]));
      await h.start(); assert.equal(h.applied(), 0); assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
      await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
      assert.equal(h.applied(), 1); assert.deepEqual(h.selection().images.map(i => i.name), originals.map(i => i.name));
      assert.equal(h.done(), 1); assert.equal(h.sends(), 0);
    } finally { await h.close(); }
  }
});

test('same-count image replacement and same-text edits invalidate pending restore and confirmation', async () => {
  for (const kind of ['images', 'picker', 'same-text', 'confirmation']) {
    const response = deferred<QuestionReask>();
    const h = await fixture({ questionReask: () => response.promise }, 'unsent draft');
    try {
      await act(async () => h.selection().replace([originals[0]]));
      await h.start();
      if (kind === 'confirmation') await act(async () => response.resolve(restored));
      if (kind === 'images') await act(async () => h.selection().replace([{ ...originals[0], name: 'different.png' }]));
      else if (kind === 'picker') await act(async () => { h.selection().beginPick(); });
      else await act(async () => h.edit('unsent draft'));
      if (kind !== 'confirmation') await act(async () => response.resolve(restored));
      else await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
      assert.equal(h.applied(), 0); assert.equal(h.draft(), 'unsent draft');
      assert.equal(h.document.querySelector('[role="dialog"]') === null, true, 'confirmation no longer authorizes the changed draft');
      assert.equal(h.selection().images[0].name, kind === 'images' ? 'different.png' : originals[0].name);
    } finally { await h.close(); }
  }
});

test('closing, reset intent, navigation, busy, and another reask suppress obsolete async replies', async () => {
  for (const action of ['close', 'reset', 'navigate', 'busy', 'new-reask']) {
    const first = deferred<QuestionReask>(), second = deferred<QuestionReask>(); let requests = 0;
    const h = await fixture({ questionReask: () => (++requests === 1 ? first.promise : second.promise) });
    try {
      await h.start();
      await act(async () => {
        if (action === 'close') h.flags.open = false;
        if (action === 'busy') h.flags.busy = true;
        if (action === 'reset') h.edit('');
        if (action === 'navigate') h.flow().invalidate();
      });
      await h.rerender();
      if (action === 'new-reask') await h.start('q-b');
      await act(async () => first.resolve(restored)); assert.equal(h.applied(), 0);
      if (action === 'new-reask') {
        await act(async () => second.resolve({ ...restored, questionId: 'q-b', text: 'second question' }));
        assert.equal(h.applied(), 1); assert.equal(h.draft(), 'second question');
      }
    } finally { await h.close(); }
  }
});

test('legacy text-only reuse does not silently erase current images', async () => {
  const h = await fixture();
  try {
    await act(async () => h.selection().replace([originals[0]]));
    await act(async () => h.flow().start({ text: 'legacy text', imageCount: 0 }));
    assert.equal(h.applied(), 0); assert.equal(h.selection().images.length, 1);
    await h.click(h.button(copy.cancel)); assert.equal(h.selection().images.length, 1);
  } finally { await h.close(); }
});
