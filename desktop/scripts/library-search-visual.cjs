const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({ win, nativeTheme, output, run, wait, shot }) => {
  const reports = [];
  const rows = '.archive-list [data-action=library-open-item]';
  const search = '[name=library-search]';
  const capture = async name => {
    win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 240));
    await shot(name);
  };
  // Sample the committed input event in the renderer, before its debounce timer can fire.
  const type = value => run(`(async () => {
    const input = document.querySelector('${search}');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
    const rows = [...document.querySelectorAll('${rows}')];
    return { count: rows.length, locked: rows.every(row => row.disabled), editable: !input.disabled,
      error: !!document.querySelector('.folder-workspace > .archive-status'), loading: !!document.querySelector('.archive-list [role=status]') };
  })()`);
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) for (const zoom of [1.5, 2]) {
    nativeTheme.themeSource = theme;
    win.setContentSize(960, 680);
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    win.webContents.setZoomFactor(zoom);
    await wait(`document.querySelectorAll('${rows}:enabled').length === 9 && !!document.querySelector('.archive-detail h1')`);
    await run('document.querySelector(".folder-back-list").click()');
    await wait(`document.querySelector('${search}').getBoundingClientRect().width > 0`);
    await run('window.libraryTest.failLoad = true');
    const previous = { count: 9, locked: true, editable: true, error: false, loading: false };
    assert.deepEqual(await type('产品'), previous);
    await wait('document.querySelector(".archive-list [role=status]")?.textContent.includes(window.libraryTest.copy.folderLoadFailed)');
    if (locale === 'zh-CN' && theme === 'dark' && zoom === 2) await capture('library-search-error-dark-200');
    await run('window.libraryTest.failLoad = false');
    assert.deepEqual(await type('产品优化调研'), previous);
    await wait(`document.querySelectorAll('${rows}:enabled').length === 7`);
    if (locale === 'zh-CN' && theme === 'light' && zoom === 1.5) await capture('library-search-restored-light-150');
    await type('no-matching-record');
    await wait('document.querySelector(".archive-list .library-empty p")?.textContent === window.libraryTest.copy.archiveNoMatches');
    if (locale === 'zh-CN' && theme === 'dark' && zoom === 1.5) await capture('library-search-empty-dark-150');
    reports.push({ locale, theme, zoom });
  }
  win.webContents.setZoomFactor(1);
  return reports;
};
