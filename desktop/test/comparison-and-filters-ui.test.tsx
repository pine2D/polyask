import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { comparisonMount } from './ui/comparison-dom';
import { button, copy, folder, record, waitForInitial, workspace } from './ui/library-test-host';
import { getLibraryCopy } from '../src/shared/library-scale-copy';

/** jsdom has no layout: give each column a scrollable range. */
function scrollable(node: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: clientHeight });
}

test('comparison columns scroll independently unless the reader opts into synchronized scrolling', async () => {
  const h = await comparisonMount(); try {
    const [left, right] = [...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')];
    scrollable(left, 2100, 100); scrollable(right, 1100, 100);
    await h.scroll(left, 500);
    assert.equal(right.scrollTop, 0, 'independent by default, so each column keeps its own restored position');
    await h.click(h.document.querySelector<HTMLInputElement>('[name="comparison-sync-scroll"]')!);
    await h.scroll(left, 1000);
    assert.equal(right.scrollTop, 500, 'the other column follows by scroll ratio');
    await h.scroll(right, 500);
    assert.equal(left.scrollTop, 1000, 'the echo of a followed scroll is not sent back');
    await h.scroll(right, 1000);
    assert.equal(left.scrollTop, 2000);
    // Shared paragraphs are marked by tint and edge; the word label stays for screen readers and the legend.
    const label = h.document.querySelector('.archive-compare-paragraph > span');
    if (label) assert.equal(label.classList.contains('sr-only'), true);
    assert.equal(h.document.querySelector('.comparison-legend') === null, false);
  } finally { await h.close(); }
});

test('library list keeps tag, favorite, status and sort behind one Filters toggle and shows selection tools only while selecting', async () => {
  const labels = getLibraryCopy('en');
  const content: FolderContent = { kind: 'archive', record };
  setShellApi(withFolderPages({ listFolders: async () => [folder], listArchiveTags: async () => ['research'],
    searchFolderContents: async () => [content], getArchive: async () => record }) as any);
  const h = await mountDom(workspace());
  try {
    await waitForInitial();
    const toggle = h.document.querySelector<HTMLButtonElement>('.library-filter-toggle')!;
    const panel = () => h.document.querySelector<HTMLElement>('.library-filter-panel')!;
    const selection = () => h.document.querySelector<HTMLElement>('.library-selection')!;
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(panel().hidden, true);
    assert.equal(panel().contains(h.document.querySelector('[name="library-sort"]')), true);
    assert.equal(selection().hidden, true, 'select-page / clear stay out of the way until multi-select');
    await h.click(toggle);
    assert.equal(panel().hidden, false);
    await h.click(button(h.document, '.library-favorite'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(h.document.querySelector('.library-filter-toggle')!.textContent, labels.filtersActive.replace('{count}', '1'));
    const multi = h.document.querySelector<HTMLButtonElement>('[data-action="library-multi-select"]')!;
    await h.click(multi);
    assert.equal(selection().hidden, false);
    assert.equal(multi.getAttribute('aria-pressed'), 'true');
    await h.click(multi);
    assert.equal(selection().hidden, true);
    assert.equal(copy.libraryClearFilters.length > 0, true);
  } finally { await h.close(); setShellApi(null); }
});
