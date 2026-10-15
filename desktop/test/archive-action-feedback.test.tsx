import { withFolderPages } from './ui/library-page-api';
import assert from 'node:assert/strict';
import React from 'react';
import test from 'node:test';
import { ArchiveSurface } from '../src/renderer/archive-surface';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountLibrary, waitForInitial } from './ui/library-test-host';

for (const locale of ['en', 'zh-CN', 'zh-TW']) {
  test(`${locale}: read-only result failures identify copy, export and source actions`, async () => {
    const copy = getCopy(locale), record = { ...archiveFixture(), results: [
      { host: 'claude.ai', label: 'Claude', text: '[Source](https://example.com/source)' }
    ] };
    let exports = 0, links = 0, clipboardWrites = 0;
    setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
      searchFolderContents: async () => [{ kind: 'archive', record }], getArchive: async () => record,
      archiveMarkdown: async () => { exports++; throw Error('fixture_export_failed'); },
      openExternal: async () => { links++; throw Error('fixture_open_failed'); }
    }) as any);
    const h = await mountLibrary(<ArchiveSurface copy={copy} locale={locale} preferredId={record.id}
      onClose={() => {}} onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null}
      pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}}
      onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} />);
    try {
      Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true,
        value: { writeText: async () => { clipboardWrites++; } } });
      await waitForInitial();
      for (const [label, expected] of [[copy.copyArchive, copy.archiveCopyFailed], [copy.exportArchive, copy.archiveExportFailed]]) {
        await h.click(h.document.querySelector<HTMLButtonElement>('.archive-actions .library-menu-trigger')!);
        const action = [...h.document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')].find(node => node.textContent === label)!;
        await h.click(action);
        assert.equal(h.document.querySelector('.archive-workspace .archive-status')?.textContent, expected);
        assert.equal(h.document.querySelector('.archive-detail h1')?.textContent, record.task);
      }
      await h.click(h.document.querySelector<HTMLAnchorElement>('.markdown-preview a')!);
      assert.equal(h.document.querySelector('.archive-workspace .archive-status')?.textContent, copy.archiveSourceOpenFailed);
      assert.equal(exports, 2); assert.equal(links, 1); assert.equal(clipboardWrites, 0);
    } finally { await h.close(); setShellApi(null); }
  });
}
