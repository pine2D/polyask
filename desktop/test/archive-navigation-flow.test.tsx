import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import { getCopy } from '../src/shared/copy';
import { SITES } from '../src/main/sites';
import { FolderWorkspace } from '../src/renderer/folder-workspace';
import { useArchiveNavigation } from '../src/renderer/use-archive-navigation';
import { setShellApi } from '../src/renderer/shell-api';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

const a = { ...archiveFixture(), id: 'history-A', text: 'History original A' };
const b = { ...archiveFixture(), id: 'new-B', text: 'Newly collected B' };
async function fixture() {
  const reads: string[] = [];
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
    searchFolderContents: async () => [{ kind: 'archive', record: a }, { kind: 'archive', record: b }],
    getArchive: async (id: string) => { reads.push(id); return id === a.id ? a : b; } }) as any);
  function Fixture() {
    const target = useArchiveNavigation();
    const [open, setOpen] = useState(false), [pendingId, setPendingId] = useState<string | null>(null);
    return <><button id="history" onClick={() => { target.history(a.id, 'read'); setOpen(true); }}>History</button>
      <button id="compare" onClick={() => { target.collection(b.id); setOpen(true); }}>Compare new result</button>
      <button id="synthesis" onClick={() => { setPendingId(b.id); target.collection(); setOpen(true); }}>Read analysis</button>
      {open && <FolderWorkspace copy={getCopy('en')} locale="en" sites={SITES} synthesisSites={[]} defaultTier={null}
        preferredId={target.preferredId ?? pendingId} comparisonId={target.comparisonId} pendingSynthesis={null} synthesisCandidate={null}
        onClose={() => setOpen(false)} onCapture={async () => b} onSendSynthesis={async () => {}}
        onCollectSynthesis={async () => {}} onSaveSynthesis={async () => b}
        renderArchive={record => <article data-record={record.id} data-view={record.id === target.comparisonId ? 'compare' : 'read'}>{record.text}</article>} />}
    </>;
  }
  const h = await mountDom(<Fixture />);
  const wait = async (id: string) => {
    for (let count = 0; count < 50; count++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      if (h.document.querySelector('article')?.getAttribute('data-record') === id) return;
    }
  };
  return { ...h, reads, wait };
}

test('a newly collected comparison replaces the earlier history-reading target', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.getElementById('history')!); await h.wait(a.id);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-close')!);
    await h.click(h.document.getElementById('compare')!); await h.wait(b.id);
    assert.equal(h.reads.at(-1), b.id, 'the new navigation must read its new archive');
    assert.equal(h.document.querySelector('article')!.textContent, b.text);
    assert.equal(h.document.querySelector('article')!.getAttribute('data-view'), 'compare');
  } finally { await h.close(); setShellApi(null); }
});

test('collecting analysis releases an old history target for the current pending archive', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.getElementById('history')!); await h.wait(a.id);
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-close')!);
    await h.click(h.document.getElementById('synthesis')!); await h.wait(b.id);
    assert.equal(h.reads.at(-1), b.id);
    assert.equal(h.document.querySelector('article')!.textContent, b.text);
    assert.equal(h.document.querySelector('article')!.getAttribute('data-view'), 'read');
  } finally { await h.close(); setShellApi(null); }
});
