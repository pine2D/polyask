import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { ArchiveRecord } from '../src/shared/archive';
import { createArchiveRecord } from '../src/shared/archive';
import type { FolderContent } from '../src/shared/task-folder';
import { setShellApi } from '../src/renderer/shell-api';
import { FolderWorkspace } from '../src/renderer/folder-workspace';
import { copy, mountLibrary, readerTitle, record, waitForInitial } from './ui/library-test-host';
import { ArchiveDetail } from '../src/renderer/archive-detail';

const other = createArchiveRecord({ ...record, task: 'Other saved result', ts: 500, createdAt: 500, updatedAt: 500 },
  { id: 'other-result', now: 500, deviceId: 'test' });
const items: FolderContent[] = [{ kind: 'archive', record }, { kind: 'archive', record: other }];

test('a late action from the previous result cannot open a decision editor over a newer item selection', async () => {
  let deferred = false;
  const pending: (() => void)[] = [];
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
    searchFolderContents: async () => items,
    getArchive: async (id: string) => {
      if (deferred) await new Promise<void>(resolve => pending.push(resolve));
      return items.find(item => item.record.id === id)?.record ?? null;
    } }) as any);
  // The callback the previous record's reader holds while its source verification is still in flight.
  let lateEvidence: (() => void) | null = null;
  const h = await mountLibrary(<FolderWorkspace copy={copy} locale="en" preferredId={null} onClose={() => {}}
    onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null}
    pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}}
    onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record}
    renderArchive={(value: ArchiveRecord, _changed, onCreateDecision) => {
      if (value.id === record.id) lateEvidence = () => onCreateDecision(value);
      return <ArchiveDetail copy={copy} locale="en" record={value} busy={false} onPatch={() => {}} onOpenSource={() => {}}
        pendingSynthesis={null} synthesisCandidate={null} onSynthesize={() => {}} onCollectSynthesis={() => {}} onSaveSynthesis={() => {}} />;
    }} />);
  try {
    await waitForInitial();
    const open = (title: string) => [...h.document.querySelectorAll<HTMLButtonElement>('[data-action="library-open-item"]')]
      .find(node => node.textContent?.includes(title));
    await h.click(open(record.task)!);
    await waitForInitial();
    assert.equal(readerTitle(h.document), record.task);
    assert.equal(lateEvidence === null, false, 'previous reader exposed its decision callback');
    deferred = true;
    await h.click(open('Other saved result')!);
    assert.equal(pending.length, 1, 'the newer selection is still reading');
    await act(async () => { lateEvidence!(); });
    assert.equal(h.document.querySelector('.decision-editor') === null, true, 'late action cannot open an editor');
    await act(async () => { pending.splice(0).forEach(resolve => resolve()); });
    await waitForInitial();
    assert.equal(h.document.querySelector('.decision-editor') === null, true);
    assert.equal(readerTitle(h.document), 'Other saved result', 'the explicit newer selection wins');
  } finally { await h.close(); setShellApi(null); }
});
