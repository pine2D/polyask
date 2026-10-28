import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import type { ArchivePatch, ArchiveRecord } from '../src/shared/archive';
import { ArchiveSurface } from '../src/renderer/archive-surface';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountLibrary, waitForInitial } from './ui/library-test-host';
import { withFolderPages } from './ui/library-page-api';

for (const locale of ['en', 'zh-CN', 'zh-TW']) {
  test(`${locale}: best source bookmark follows confirmed saves and survives reopening`, async () => {
    const copy = getCopy(locale);
    let records: ArchiveRecord[] = [{ ...archiveFixture(), favorite: true, winnerHost: null, results: [
      { host: 'claude.ai', label: 'Claude', text: 'First answer' },
      { host: 'chatgpt.com', label: 'ChatGPT', text: 'Second answer' }
    ] }];
    records.push({ ...records[0], id: 'other-result', task: 'Another saved question' });
    let settle: (ok: boolean) => void = () => { throw Error('No pending save'); };
    const patches: ArchivePatch[] = [];
    setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
      searchFolderContents: async () => records.map(record => ({ kind: 'archive', record })),
      getArchive: async (id: string) => records.find(record => record.id === id),
      updateArchive: (id: string, patch: ArchivePatch) => new Promise<ArchiveRecord>((resolve, reject) => {
        patches.push(patch);
        settle = ok => {
          if (!ok) { reject(Error('fixture_save_failed')); return; }
          records = records.map(record => record.id === id ? { ...record, ...patch } : record);
          resolve(records.find(record => record.id === id)!);
        };
      })
    }) as any);
    const h = await mountLibrary(<ArchiveSurface copy={copy} locale={locale} preferredId={records[0].id}
      onClose={() => {}} onCapture={async () => records[0]} sites={[]} synthesisSites={[]} defaultTier={null}
      pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}}
      onCollectSynthesis={async () => {}} onSaveSynthesis={async () => records[0]} />);
    const bookmark = (index: number | null) => {
      const links = [...h.document.querySelectorAll<HTMLAnchorElement>('.archive-answer-nav a')];
      assert.equal(links.length, 2);
      assert.equal(links.filter(link => link.dataset.best === 'true').length, index === null ? 0 : 1);
      for (const [i, link] of links.entries()) {
        assert.equal(link.getAttribute('href'), `#archive-answer-${i}`);
        assert.equal(link.hasAttribute('aria-current'), false);
        assert.equal(!!link.querySelector('svg'), i === index);
        if (i === index) {
          assert.equal(link.getAttribute('aria-label'), `[S${i + 1}] ${records[0].results[i].label} · ${copy.archiveBestAnswer}`);
          assert.equal(link.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
        }
      }
    };
    try {
      await waitForInitial(); bookmark(null);
      let previous: number | null = null;
      for (const [index, expected] of [[0, 0], [1, 1], [1, null], [0, 0]] as const) {
        await h.click(h.document.querySelector<HTMLButtonElement>(`#archive-answer-${index} .archive-answer-actions button[aria-pressed]`)!);
        bookmark(previous);
        assert.equal([...h.document.querySelectorAll<HTMLButtonElement>('.archive-answer-actions button')].every(button => button.disabled), true);
        await act(async () => settle(true)); await waitForInitial();
        bookmark(expected); previous = expected;
      }
      await h.click(h.document.querySelector<HTMLButtonElement>('#archive-answer-1 .archive-answer-actions button[aria-pressed]')!);
      bookmark(0);
      await act(async () => settle(false)); await waitForInitial();
      bookmark(0);
      assert.equal(h.document.querySelector('.archive-workspace .archive-status')?.textContent, copy.archiveSaveFailed);
      assert.deepEqual(patches.map(patch => patch.winnerHost), ['claude.ai', 'chatgpt.com', null, 'claude.ai', 'chatgpt.com']);
      for (const [id, expected] of [['other-result', null], [records[0].id, 0]] as const) {
        const row = [...h.document.querySelectorAll<HTMLButtonElement>('[data-action=library-open-item]')]
          .find(button => button.querySelector('.library-item-title')?.textContent === records.find(record => record.id === id)!.task)!;
        await h.click(row); await waitForInitial(); bookmark(expected);
      }
    } finally { await h.close(); setShellApi(null); }
  });
}
