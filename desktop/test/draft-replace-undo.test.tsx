import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { FeedbackProvider } from '../src/renderer/feedback-provider';
import { useDraftReplaceUndo } from '../src/renderer/use-draft-replace-undo';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');

async function fixture(initial: string) {
  let replace!: (value: string) => void, edit!: (value: string) => void, text = initial, focused = 0;
  function Host() {
    const [value, setValue] = useState(initial); text = value; edit = setValue;
    replace = useDraftReplaceUndo(copy, value, setValue, () => { focused++; });
    return null;
  }
  const h = await mountDom(<FeedbackProvider copy={copy}><Host /></FeedbackProvider>);
  const undo = () => [...h.document.querySelectorAll<HTMLButtonElement>('.feedback-bar button')].find(node => node.textContent === copy.undoDraftReplace) ?? null;
  const notice = () => h.document.querySelector('.feedback-notice')!.textContent;
  return { ...h, undo, notice, text: () => text, focused: () => focused,
    replace: (value: string) => act(async () => replace(value)), edit: (value: string) => act(async () => edit(value)) };
}

test('replacing a non-empty draft is immediate and offers one undo that restores the previous text', async () => {
  const h = await fixture('Existing work');
  try {
    await h.replace('Template question');
    assert.equal(h.text(), 'Template question');
    assert.equal(h.notice(), copy.draftReplaced);
    assert.equal(h.focused(), 1);
    await h.click(h.undo()!);
    assert.equal(h.text(), 'Existing work');
    assert.equal(h.notice(), copy.draftReplaceUndone);
    assert.equal(h.undo() === null, true, 'undo is single-use');
    assert.equal(h.focused(), 2);
  } finally { await h.close(); }
});

test('undo never discards edits made after the replacement', async () => {
  const h = await fixture('Existing work');
  try {
    await h.replace('Template question');
    await h.edit('Template question, refined');
    await h.click(h.undo()!);
    assert.equal(h.text(), 'Template question, refined');
    assert.equal(h.notice(), copy.draftReplaceUndoStale);
  } finally { await h.close(); }
});

test('an empty or identical draft is filled without an undo offer', async () => {
  for (const initial of ['', '   ', 'Template question']) {
    const h = await fixture(initial);
    try {
      await h.replace('Template question');
      assert.equal(h.text(), 'Template question');
      assert.equal(h.undo() === null, true);
    } finally { await h.close(); }
  }
});
