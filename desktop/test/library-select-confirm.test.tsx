import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';
import { copy, decision, record, waitForInitial, workspace } from './ui/library-test-host';

const other = { ...decision, id: 'other-decision', archiveId: 'other-decision', title: 'Second decision', updatedAt: 900 };
const items: FolderContent[] = [{ kind: 'decision', record: decision }, { kind: 'decision', record: other }];

test('switching away from a dirty decision asks to discard exactly once', async () => {
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], getArchive: async () => record,
    searchFolderContents: async () => items }) as any);
  const h = await mountDom(workspace({ preferredId: null }));
  try {
    await waitForInitial();
    const open = () => [...h.document.querySelectorAll<HTMLButtonElement>('[data-action="library-open-item"]')];
    await h.click(open()[0]!);
    const edit = [...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(n => n.textContent === copy.decisionEdit)!;
    await h.click(edit);
    await h.input(h.document.querySelector<HTMLInputElement>('[name="decision-title"]')!, 'Dirty title');
    await h.click(open()[1]!);
    const confirm = () => [...h.document.querySelectorAll<HTMLButtonElement>('.confirm-dialog .confirm-actions button')].find(b => b.textContent === copy.decisionConfirm);
    assert.equal(!!confirm(), true, 'first confirmation shows');
    await h.click(confirm()!);
    await waitForInitial();
    assert.equal(h.document.querySelector('.confirm-dialog') === null, true, 'no second confirmation after approving');
    assert.equal(h.document.querySelector('.decision-editor h1')?.textContent, 'Second decision');
  } finally { await h.close(); setShellApi(null); }
});
