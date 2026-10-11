import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { ConfirmDialog } from '../src/renderer/confirm-dialog';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

const copy = getCopy('en');

test("confirm dialog reports don't ask again only through confirmation and keeps the box in the focus loop", async () => {
  const decisions: boolean[] = [];
  const h = await mountDom(<ConfirmDialog copy={copy} title="T" message="M" confirmLabel="Go" cancelLabel="Stay"
    dontAskLabel={copy.confirmDontAsk} onConfirm={dontAsk => decisions.push(dontAsk)} onCancel={() => undefined} />);
  try {
    const box = h.document.querySelector<HTMLInputElement>('input[name="confirm-dont-ask"]')!;
    assert.equal(box.checked, false);
    assert.equal(h.document.activeElement?.textContent, 'Stay', 'focus still defaults to cancel');
    const primary = h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!;
    await h.click(primary);
    await h.click(box);
    await h.click(primary);
    assert.deepEqual(decisions, [false, true]);
    const nodes = [...h.document.querySelectorAll<HTMLElement>('[role="dialog"] button, [role="dialog"] input')];
    nodes.at(-1)!.focus();
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    assert.equal(h.document.activeElement === nodes[0], true);
    assert.ok(nodes.includes(box));
  } finally { await h.close(); }
});

test('confirm dialog without a don\'t-ask label renders no checkbox (destructive confirmations)', async () => {
  const h = await mountDom(<ConfirmDialog copy={copy} title="T" message="M" confirmLabel="Delete" cancelLabel="Stay" tone="danger"
    onConfirm={() => undefined} onCancel={() => undefined} />);
  try { assert.equal(h.document.querySelector('input[name="confirm-dont-ask"]') === null, true); }
  finally { await h.close(); }
});
