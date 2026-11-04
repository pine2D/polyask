import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { historyMount, copy, deferred } from './ui/history-dom';

test('zoom control ignores stale reads and responses after a newer native zoom notification', async () => {
  const initial = deferred<number>(), click = deferred<number>();
  let notify = (_zoom: number) => {}, subscriptions = 0;
  const h = await historyMount({ getPageZoom: () => initial.promise,
    onPageZoom: (listener: (zoom: number) => void) => { notify = listener; subscriptions++; return () => { subscriptions--; }; },
    changePageZoom: () => click.promise });
  try {
    await act(async () => notify(1.25));
    await act(async () => initial.resolve(1));
    assert.equal(h.document.querySelector('.page-zoom-reset')?.textContent, '125%');
    await h.click(h.document.querySelector<HTMLElement>('.page-zoom-in')!);
    await act(async () => notify(1.75));
    await act(async () => click.resolve(1.5));
    assert.equal(h.document.querySelector('.page-zoom-reset')?.textContent, '175%');
    await act(async () => notify(5));
    assert.equal(h.document.querySelector<HTMLButtonElement>('.page-zoom-in')?.disabled, true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('.page-zoom-reset')?.disabled, false);
  } finally { await h.close(); }
  assert.equal(subscriptions, 0);
});

test('failed zoom keeps the previous ratio and permits retry without losing focus', async () => {
  let fails = true;
  const h = await historyMount({ getPageZoom: async () => 1, onPageZoom: () => () => {},
    changePageZoom: async () => { if (fails) throw Error('synthetic_zoom_failure'); return 1.1; } });
  try {
    const button = h.document.querySelector<HTMLButtonElement>('.page-zoom-in')!;
    await act(async () => button.focus()); await h.click(button);
    assert.equal(h.document.querySelector('.page-zoom-error')?.textContent, copy.pageZoomFailed);
    assert.equal(h.document.querySelector('.page-zoom-reset')?.textContent, '100%');
    assert.equal(h.document.activeElement === button, true);
    fails = false; await h.click(button);
    assert.equal(h.document.querySelector('.page-zoom-error') === null, true);
    assert.equal(h.document.querySelector('.page-zoom-reset')?.textContent, '110%');
  } finally { await h.close(); }
});
