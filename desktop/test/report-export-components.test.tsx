import assert from 'node:assert/strict';
import { act } from 'react';
import test from 'node:test';
import { ArchiveSurface } from '../src/renderer/archive-surface';
import { DecisionWorkspace } from '../src/renderer/decision-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { useReportExport } from '../src/renderer/use-report-export';
import { getCopy } from '../src/shared/copy';
import type { ReportExportRequest, ReportExportResult } from '../src/shared/report-export';
import { archiveFixture } from './fixtures';
import { mountLibrary, waitForInitial, decision } from './ui/library-test-host';
import { withFolderPages } from './ui/library-page-api';
import { mountDom } from './ui/dom-harness';

for (const [locale, language] of [['en', 'en'], ['zh-CN', 'zhCN'], ['zh-TW', 'zhTW']]) {
  test(`${locale}: saved-answer menu retains Markdown and sends only finite HTML/PDF intent`, async () => {
    const copy = getCopy(locale), record = archiveFixture(), calls: ReportExportRequest[] = [];
    let markdown = 0;
    setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [],
      searchFolderContents: async () => [{ kind: 'archive', record }], getArchive: async () => record,
      archiveMarkdown: async () => { markdown++; return 'markdown'; },
      exportReport: async (value: ReportExportRequest) => { calls.push(value); return { status: value.format === 'html' ? 'saved' : 'cancelled' }; }
    }) as any);
    const h = await mountLibrary(<ArchiveSurface copy={copy} locale={locale} preferredId={record.id}
      onClose={() => {}} onCapture={async () => record} sites={[]} synthesisSites={[]} defaultTier={null}
      pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async () => {}}
      onCollectSynthesis={async () => {}} onSaveSynthesis={async () => record} />);
    try {
      await waitForInitial();
      for (const [label, status] of [[copy.reportExportHtml, copy.reportExported], [copy.reportExportPdf, copy.reportCancelled]]) {
        await h.click(h.document.querySelector<HTMLButtonElement>('.archive-actions .library-menu-trigger')!);
        const items = [...h.document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
        assert.equal(items.some(item => item.textContent === copy.exportArchive), true);
        const action = items.find(item => item.textContent === label)!;
        assert.equal(action.disabled, false);
        await h.click(action);
        assert.equal(h.document.querySelector('.archive-workspace .archive-status')?.textContent, status);
      }
      assert.deepEqual(calls, [{ kind: 'archive', id: record.id, format: 'html', locale: language },
        { kind: 'archive', id: record.id, format: 'pdf', locale: language }]);
      assert.equal(markdown, 0);
      assert.equal(h.document.querySelector('.archive-detail h1')?.textContent, record.task);
    } finally { await h.close(); setShellApi(null); }
  });
}

test('saved decision menu exports the selected card while editing and new-card controls offer no report action', async () => {
  const copy = getCopy('en'), calls: ReportExportRequest[] = [];
  setShellApi({ getArchive: async () => archiveFixture(), exportReport: async (value: ReportExportRequest) => {
    calls.push(value); return { status: 'failed', code: 'report_source_changed' };
  } } as any);
  const props = { copy, locale: 'en', embedded: true, initialRecord: decision, initialSource: null,
    onArchives: () => {}, onClose: () => {} };
  const h = await mountLibrary(<DecisionWorkspace {...props} />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-decision-actions .library-menu-trigger')!);
    const items = [...h.document.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
    assert.equal(items.some(item => item.textContent === copy.decisionExport), true);
    await h.click(items.find(item => item.textContent === copy.reportExportPdf)!);
    assert.deepEqual(calls, [{ kind: 'decision', id: decision.id, format: 'pdf', locale: 'en' }]);
    assert.equal(h.document.querySelector('.archive-status')?.textContent, copy.reportSourceChanged);
    const edit = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === copy.decisionEdit)!;
    await h.click(edit);
    assert.equal(h.document.querySelector('.library-decision-actions .library-menu-trigger') === null, true);
  } finally { await h.close(); setShellApi(null); }
});

test('late export result cannot replace status after the selected record changes', async () => {
  let resolve!: (result: ReportExportResult) => void;
  const pending = new Promise<ReportExportResult>(done => { resolve = done; }), messages: string[] = [], copy = getCopy('en');
  setShellApi({ exportReport: () => pending } as any);
  function Host({ id }: { id: string }) {
    const exportReport = useReportExport({ kind: 'archive', id, locale: 'en', copy, onStatus: value => { messages.push(value); } });
    return <button onClick={() => { void exportReport('html'); }}>Export</button>;
  }
  const h = await mountDom(<Host id="first" />);
  try {
    await h.click(h.document.querySelector('button')!);
    await h.render(<Host id="second" />);
    await act(async () => { resolve({ status: 'saved' }); await pending; });
    assert.deepEqual(messages, [copy.reportExporting]);
  } finally { await h.close(); setShellApi(null); }
});
