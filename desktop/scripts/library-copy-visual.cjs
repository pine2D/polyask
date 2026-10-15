const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, nativeTheme, output, run, wait, click, fill, shot }) => {
  const reports = [];
  const measure = selector => run(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)}), box = node.getBoundingClientRect();
    return { text: node.textContent, width: node.clientWidth, scroll: node.scrollWidth,
      height: box.height, top: box.top, bottom: box.bottom, right: box.right, viewport: innerWidth, viewportHeight: innerHeight };
  })()`);
  const contained = box => {
    assert.ok(box.width > 120 && box.height > 12 && box.scroll <= box.width + 1,
      `copy must remain visible and wrap: ${JSON.stringify(box)}`);
    assert.ok(box.right <= box.viewport + 1 && box.top >= 0 && box.bottom <= box.viewportHeight + 1,
      `copy must remain within the viewport: ${JSON.stringify(box)}`);
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) for (const zoom of [1, 2]) {
    const width = zoom === 1 ? 960 : 1280;
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(width, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    win.webContents.setZoomFactor(zoom);
    await wait('!!document.querySelector(".archive-detail h1")');
    const labels = await run(`(() => { const c = window.libraryTest.copy;
      return { copy: c.archiveCopyFailed, export: c.archiveExportFailed, source: c.archiveSourceOpenFailed,
        capture: c.libraryEmptyHint, decision: c.libraryDecisionEmptyHint, folder: c.libraryFolderEmptyHint, search: c.libraryNoMatchesHint };
    })()`);
    await run('window.libraryTest.failMarkdown=true; window.libraryTest.failExternal=true');
    const failures = [];
    for (const [index, expected] of [[1, labels.copy], [2, labels.export]]) {
      await click('.archive-actions .library-menu-trigger');
      await click(`[role=menuitem]:nth-child(${index})`);
      await wait(`document.querySelector('.archive-workspace .archive-status')?.textContent === ${JSON.stringify(expected)}`);
      const box = await measure('.archive-workspace .archive-status'); contained(box); failures.push(box);
    }
    await click('.archive-answer .markdown-preview a');
    await wait(`document.querySelector('.archive-workspace .archive-status')?.textContent === ${JSON.stringify(labels.source)}`);
    const source = await measure('.archive-workspace .archive-status'); contained(source); failures.push(source);
    assert.equal(await run('window.libraryTest.writes + window.libraryTest.folderWrites'), 0, 'read-only failures must not alter records');
    assert.equal(await run('window.libraryTest.links.length'), 0, 'failed opening must not report a successful link action');
    if (locale === 'en' && zoom === 2) await shot(`copy-errors-${theme}-200`);

    win.webContents.setZoomFactor(1);
    await win.loadFile(join(output, 'index.html'), { query: { locale, emptyLibrary: '1' } });
    win.webContents.setZoomFactor(zoom);
    const empty = [];
    const checkHint = async expected => {
      await wait(`document.querySelector('.archive-list[aria-busy=false] .library-empty small')?.textContent === ${JSON.stringify(expected)}`);
      const box = await measure('.archive-list .library-empty small'); contained(box); empty.push(box);
      assert.equal(await run('document.querySelector(".library-welcome p")?.textContent'), expected,
        'empty list and welcome panel must offer the same contextual next step');
    };
    await checkHint(labels.capture);
    await click('.library-segments button:nth-child(3)'); await checkHint(labels.decision);
    await click('.folder-back-navigation'); await click('.folder-sidebar nav button:nth-child(3)'); await checkHint(labels.folder);
    if (zoom === 1) await shot(`empty-folder-${locale}-${theme}`);
    await fill('[name=library-search]', 'unmatched'); await checkHint(labels.search);
    await click('.library-list-summary button:nth-child(3)'); await checkHint(labels.folder);
    await click('.folder-back-navigation'); await click('.folder-sidebar nav button:nth-child(2)'); await checkHint(labels.decision);
    if (locale === 'zh-TW' && zoom === 2) await shot(`empty-decision-${theme}-200`);
    reports.push({ locale, theme, width, zoom, failures, empty, writes: await run('window.libraryTest.writes + window.libraryTest.folderWrites') });
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600, 1000); nativeTheme.themeSource = 'light';
  writeFileSync(join(output, 'copy-report.json'), JSON.stringify(reports, null, 2));
  console.log(`Library copy passed: ${reports.length} locale/theme/zoom groups, read-only failure messages and six empty-state paths.`);
  return reports;
};
