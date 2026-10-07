import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { archiveItems, button, ContentListHost, mountLibrary as mountDom } from './ui/library-test-host';

test('a thousand complete results render one bounded page with a truthful range and total', async () => {
  const h = await mountDom(<ContentListHost items={archiveItems(1_000)} />);
  try {
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 100);
    assert.equal(h.document.querySelector('.library-pagination')?.textContent?.includes('1–100'), true);
    assert.equal(h.document.querySelector('.library-pagination')?.textContent?.includes('1000'), true);
    assert.equal(h.document.querySelector('[name="library-page"]')?.textContent?.includes('1 / 10'), true);
  } finally { await h.close(); }
});

test('the final item stays reachable by the page selector and previous navigation', async () => {
  const h = await mountDom(<ContentListHost items={archiveItems(1_000)} />);
  try {
    assert.equal(h.document.querySelector('[name="library-page"]') !== null, true);
    await h.click(button(h.document, '[name="library-page"]'));
    const last = [...h.document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.trim() === '10 / 10');
    assert.equal(last !== undefined, true); await h.click(last!);
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 100);
    assert.equal([...h.document.querySelectorAll('.library-item-title')].at(-1)?.textContent, 'Result 0999');
    await h.click(button(h.document, '[data-action="library-previous-page"]'));
    assert.equal(h.document.querySelector('.library-item-title')?.textContent, 'Result 0800');
  } finally { await h.close(); }
});

test('a shrinking last page is clamped without dropping the remaining result', async () => {
  const h = await mountDom(<ContentListHost items={archiveItems(101)} page={9} />);
  try {
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 1);
    assert.equal(h.document.querySelector('.library-item-title')?.textContent, 'Result 0100');
    await h.render(<ContentListHost items={archiveItems(100)} page={9} />);
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 100);
    assert.equal(h.document.querySelector('[name="library-page"]')?.textContent?.includes('1 / 1'), true);
  } finally { await h.close(); }
});

test('created sorting uses createdAt and preserves all input records', async () => {
  const items = archiveItems(3); const ids = items.map(item => item.record.id).join(',');
  const h = await mountDom(<ContentListHost items={items} />);
  try {
    assert.equal(h.document.querySelector('[name="library-sort"]') !== null, true);
    await h.click(button(h.document, '[name="library-sort"]'));
    const created = [...h.document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes('Created, newest first'));
    assert.equal(created !== undefined, true); await h.click(created!);
    assert.equal(h.document.querySelector('.library-item-title')?.textContent, 'Result 0002');
    assert.equal(items.map(item => item.record.id).join(','), ids);
  } finally { await h.close(); }
});

test('empty results have no selectable rows or enabled page navigation', async () => {
  const h = await mountDom(<ContentListHost items={[]} />);
  try {
    assert.equal(h.document.querySelectorAll('.library-item-title').length, 0);
    assert.equal(h.document.querySelectorAll('input[type="checkbox"]:not(:disabled)').length, 0);
    assert.equal(h.document.querySelectorAll('.library-pagination button:not(:disabled)').length, 0);
  } finally { await h.close(); }
});
