import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { copy, historyMount, waitFor } from './ui/history-dom';

test('opening a history copy focuses its named reading region and returning focuses search', async () => {
  const h = await historyMount();
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    await h.click(h.document.querySelector<HTMLElement>('.question-main')!);
    const reader = h.document.querySelector<HTMLElement>('.question-reader')!;
    assert.equal(h.document.activeElement === reader, true, 'PageDown must target the saved answer immediately');
    assert.equal(reader.tabIndex, 0);
    assert.equal(reader.getAttribute('role'), 'region');
    assert.equal(reader.getAttribute('aria-label'), copy.questionCopies);
    reader.scrollTop = 147;
    await h.rerender({ busy: true });
    assert.equal(h.document.activeElement === reader, true);
    assert.equal(reader.scrollTop, 147, 'updates preserve the reading position');
    const back = h.button(copy.questionBack);
    await act(async () => back.focus());
    await h.rerender({ busy: false });
    assert.equal(h.document.activeElement === back, true, 'refresh does not steal deliberately moved focus');
    await h.click(h.button(copy.questionBack));
    assert.equal(h.document.activeElement === h.document.querySelector('.question-search input'), true);
  } finally { await h.close(); }
});

test('PageDown and PageUp in history search transfer focus and scroll the list exactly once', async () => {
  const h = await historyMount();
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    const input = h.document.querySelector<HTMLInputElement>('.question-search input')!;
    const list = h.document.querySelector<HTMLElement>('.question-scroll')!;
    Object.defineProperties(list, { clientHeight: { value: 400 }, scrollHeight: { value: 1800 } });
    const key = async (name: string) => {
      let prevented = false;
      await act(async () => { input.focus(); const event = new h.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }); input.dispatchEvent(event); prevented = event.defaultPrevented; });
      assert.equal(prevented, true, 'prevent the browser from paging a second time');
      assert.equal(h.document.activeElement === list, true);
    };
    await key('PageDown'); assert.equal(list.scrollTop, 350);
    await key('PageUp'); assert.equal(list.scrollTop, 0);
    assert.equal(list.getAttribute('aria-label'), copy.questionHistory);
  } finally { await h.close(); }
});

test('history search leaves modified paging and composing input untouched', async () => {
  const h = await historyMount();
  try {
    await waitFor(() => h.document.querySelector('.question-main'));
    const input = h.document.querySelector<HTMLInputElement>('.question-search input')!;
    const list = h.document.querySelector<HTMLElement>('.question-scroll')!;
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
      await act(async () => {
        input.focus(); const event = new h.window.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true, ...options });
        input.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
        assert.equal(h.document.activeElement === input, true);
        assert.equal(list.scrollTop, 0);
      });
    }
  } finally { await h.close(); }
});
