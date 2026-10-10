import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { copy, decision, record, waitForInitial, waitForQuery, workspace } from './ui/library-test-host';

test('a latest matching decision result updates the same mounted reading surface', async () => {
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], getArchive: async () => record,
    searchFolderContents: async (filters: { query?: string }) => [{ kind: 'decision', record: filters.query
      ? { ...decision, title: 'Newest decision title', conclusion: 'Latest saved conclusion', updatedAt: 2_000 } : decision }],
  }) as any);
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await waitForInitial(); await h.click(h.document.querySelector<HTMLButtonElement>('[data-action="library-open-item"]')!);
    assert.equal(h.document.querySelector('.decision-editor h1')?.textContent, decision.title);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="library-search"]')!, 'decision'); await waitForQuery();
    assert.equal(h.document.querySelector('.decision-editor h1')?.textContent, 'Newest decision title');
    assert.equal(h.document.querySelector('.decision-editor')?.textContent?.includes('Latest saved conclusion'), true);
  } finally { await h.close(); setShellApi(null); }
});

test('new same-ID saved props do not replace an edited decision draft', async () => {
  setShellApi({ getArchive: async () => record } as any);
  const render = (updated = false) => <DecisionWorkspace embedded copy={copy} locale="en" initialSource={null}
    initialRecord={updated ? { ...decision, title: 'Remote decision title', updatedAt: 2_000 } : decision}
    onArchives={() => {}} onClose={() => {}} />;
  const h = await mountDom(render());
  try {
    const edit = [...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionEdit)!;
    await h.click(edit); await h.input(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')!, 'Local unsaved title');
    await h.render(render(true));
    assert.equal(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')?.value, 'Local unsaved title');
    assert.equal(h.document.querySelector('.decision-detail-actions')?.textContent?.includes(copy.decisionUnsaved), true);
  } finally { await h.close(); setShellApi(null); }
});
