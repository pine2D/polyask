import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { mountDom } from './ui/dom-harness';
import { archiveItems, button, ContentListHost, decision, record } from './ui/library-test-host';

test('checkbox selection and opening a reader are separate actions for same-ID kinds', async () => {
  const h = await mountDom(<ContentListHost items={[{ kind: 'archive', record }, { kind: 'decision', record: decision }]} />);
  try {
    const checks = h.document.querySelectorAll<HTMLInputElement>('.library-content-row input[type="checkbox"]');
    assert.equal(checks.length, 2); await h.click(checks[0]);
    assert.equal(h.document.querySelector('#test-selected')?.textContent, `archive:${record.id}`);
    assert.equal(h.document.querySelector('#test-open')?.textContent, '');
    await h.click(checks[1]);
    assert.equal(h.document.querySelector('#test-selected')?.textContent?.split('\n').sort().join(','), `archive:${record.id},decision:${record.id}`);
    await h.click(button(h.document, '.library-content-row [data-action="library-open-item"]'));
    assert.equal(h.document.querySelector('#test-open')?.textContent, `archive:${record.id}`);
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 2);
    assert.equal(h.document.querySelector('button input,button button') !== null, false);
  } finally { await h.close(); }
});

test('select page chooses only its hundred rows and keeps explicit keys on another page', async () => {
  const h = await mountDom(<ContentListHost items={archiveItems(201)} />);
  try {
    assert.equal(h.document.querySelector('[data-action="library-select-page"]') !== null, true);
    await h.click(button(h.document, '[data-action="library-select-page"]'));
    assert.equal(h.document.querySelector('#test-selected')?.textContent?.split('\n').length, 100);
    assert.equal(h.document.querySelector('#test-selected')?.textContent?.includes('result-0100'), false);
    await h.click(button(h.document, '[data-action="library-next-page"]'));
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 0);
    await h.click(h.document.querySelector<HTMLInputElement>('.library-content-row input[type="checkbox"]')!);
    assert.equal(h.document.querySelector('#test-selected')?.textContent?.split('\n').length, 101);
    assert.equal(h.document.querySelector('.library-selection-summary')?.textContent?.includes('101'), true);
    assert.equal(h.document.querySelector('.library-selection-summary')?.textContent?.includes('201'), true);
  } finally { await h.close(); }
});

test('successful matching data intersects explicit selection and does not select unseen results', async () => {
  const all = archiveItems(3); const h = await mountDom(<ContentListHost items={all} />);
  try {
    assert.equal(h.document.querySelector('.library-content-row input') !== null, true);
    await h.click(h.document.querySelector<HTMLInputElement>('.library-content-row input')!);
    await h.click(h.document.querySelectorAll<HTMLInputElement>('.library-content-row input')[1]);
    await h.render(<ContentListHost items={[all[1], all[2]]} />);
    assert.equal(h.document.querySelector('#test-selected')?.textContent, 'archive:result-0001');
    assert.equal(h.document.querySelectorAll('.library-content-row input:checked').length, 1);
  } finally { await h.close(); }
});

test('pending and failed reads retain selected keys while disabling selection changes', async () => {
  const all = archiveItems(2); const h = await mountDom(<ContentListHost items={all} />);
  try {
    assert.equal(h.document.querySelector('.library-content-row input') !== null, true);
    await h.click(h.document.querySelector<HTMLInputElement>('.library-content-row input')!);
    await h.render(<ContentListHost items={[]} loading />);
    assert.equal(h.document.querySelector('#test-selected')?.textContent, 'archive:result-0000');
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-action="library-select-page"]')?.disabled, true);
    await h.render(<ContentListHost items={[]} failed />);
    assert.equal(h.document.querySelector('#test-selected')?.textContent, 'archive:result-0000');
    assert.equal(h.document.querySelector<HTMLButtonElement>('[data-action="library-select-page"]')?.disabled, true);
  } finally { await h.close(); }
});
