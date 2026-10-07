import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import type { FolderContent, FolderFilters } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { copy, decision, record, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

const content: FolderContent = { kind: 'decision', record: decision };
function deferredSearch() {
  const finishes = new Map<string, (items: readonly FolderContent[]) => void>();
  setShellApi({ listFolders: async () => [], listArchiveTags: async () => [], getArchive: async () => record,
    searchFolderContents: (filters: FolderFilters) => filters.query
      ? new Promise<readonly FolderContent[]>(resolve => finishes.set(filters.query!, resolve)) : Promise.resolve([content]),
  } as any);
  return finishes;
}
async function startPendingDraft(h: Awaited<ReturnType<typeof mountDom>>) {
  await waitForInitial();
  await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="library-open-item"]')!);
  await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'exclude');
  await waitForQuery();
  const edit = [...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')]
    .find(node => node.textContent === copy.decisionEdit)!;
  await h.click(edit);
  await h.input(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')!, 'Unsaved while searching');
}
function confirmationButton(doc: Document, label: string) {
  const node = [...doc.querySelectorAll<HTMLButtonElement>('.confirm-dialog .confirm-actions button')]
    .find(button => button.textContent === label);
  assert.equal(!!node, true, 'the current discard confirmation exposes the requested action');
  return node!;
}

test('a nonmatching response asks before removing a draft edited while the query was pending', async () => {
  const finishes = deferredSearch(); const h = await mountDom(workspace({ preferredId: null }));
  try {
    await startPendingDraft(h); await act(async () => finishes.get('exclude')!([]));
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true, 'newly dirty reading requires confirmation at response time');
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')?.value, 'Unsaved while searching');
    await h.click(confirmationButton(h.document, copy.decisionCancel));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')?.value, 'Unsaved while searching');
    assert.equal(h.document.querySelector('.decision-workspace') !== null, true);
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, 'exclude');
  } finally { await h.close(); setShellApi(null); }
});

test('an explicit confirmation can discard the still-current nonmatching draft', async () => {
  const finishes = deferredSearch(); const h = await mountDom(workspace({ preferredId: null }));
  try {
    await startPendingDraft(h); await act(async () => finishes.get('exclude')!([]));
    await h.click(confirmationButton(h.document, copy.decisionConfirm));
    assert.equal(h.document.querySelector('.decision-workspace') === null, true);
    assert.equal(h.document.querySelector('.library')?.getAttribute('data-pane'), 'list');
  } finally { await h.close(); setShellApi(null); }
});

test('a newer search intent replaces an older result confirmation and preserves its matching draft', async () => {
  const finishes = deferredSearch(); const h = await mountDom(workspace({ preferredId: null }));
  try {
    await startPendingDraft(h); await act(async () => finishes.get('exclude')!([]));
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'newest');
    await h.click(confirmationButton(h.document, copy.decisionConfirm)); await waitForQuery();
    await act(async () => finishes.get('newest')!([content]));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, 'newest');
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')?.value, 'Unsaved while searching');
    assert.equal(h.document.querySelector('.decision-workspace') !== null, true);
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true);
  } finally { await h.close(); setShellApi(null); }
});

test('an older query response cannot replace the confirmation for a newer pending search intent', async () => {
  const finishes = deferredSearch(); const h = await mountDom(workspace({ preferredId: null }));
  try {
    await startPendingDraft(h);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'newest');
    assert.equal(h.document.querySelector('.confirm-dialog') !== null, true);
    await act(async () => finishes.get('exclude')!([]));
    await h.click(confirmationButton(h.document, copy.decisionConfirm)); await waitForQuery();
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="library-search"]')?.value, 'newest');
    assert.equal(finishes.has('newest'), true, 'the latest confirmed search starts its own request');
    await act(async () => finishes.get('newest')!([content]));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')?.value, 'Unsaved while searching');
  } finally { await h.close(); setShellApi(null); }
});
