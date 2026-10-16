const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const accessibility = require('./ui-accessibility.cjs');

module.exports = async ({ win, nativeTheme, output, run, wait, click, shot }) => {
  const reports = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(960, 680);
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    await wait('document.querySelectorAll(".archive-answer .markdown-table").length===9');
    const reading = await run(`(() => [...document.querySelectorAll('.archive-answer .markdown-table')].map(node => ({
      name:node.getAttribute('aria-label'),focusable:node.tabIndex===0,role:node.getAttribute('role'),
      headers:node.querySelectorAll('th[scope=col]').length,text:node.querySelector('table').textContent})))()`);
    assert.equal(new Set(reading.map(item => item.name)).size, 9);
    assert.equal(reading.every((item, index) => item.name.startsWith('[S'+(index+1)+']') && item.focusable && item.role==='region' && item.headers===3), true);
    assert.equal(new Set(reading.map(item => item.text)).size, 1, 'identical tables retain identical content');
    const tree = await accessibility(win), regions = tree.filter(node => node.role === 'region').map(node => node.name);
    assert.equal(reading.every(item => regions.filter(name => name === item.name).length === 1), true);
    await run('document.querySelector(".markdown-table").scrollIntoView({block:"center"}); document.querySelector(".markdown-table").focus()');
    assert.equal(await run('document.activeElement===document.querySelector(".markdown-table")'), true);
    if (theme === 'dark') await shot(`table-source-${locale}-${theme}`);
    await click('.library-view-switch button:nth-child(2)');
    await wait('document.querySelectorAll(".archive-compare-column .markdown-table").length===2');
    const comparison = await run('[...document.querySelectorAll(".archive-compare-column .markdown-table")].map(node=>node.getAttribute("aria-label"))');
    assert.equal(new Set(comparison).size, 2);
    assert.equal(comparison[0].includes('[S1] Claude'), true); assert.equal(comparison[1].includes('[S2] ChatGPT'), true);
    const comparisonTree = await accessibility(win);
    assert.equal(comparison.every(name => comparisonTree.some(node => node.role === 'region' && node.name === name)), true);
    assert.equal(await run('window.libraryTest.writes+window.libraryTest.folderWrites'), 0);
    reports.push({ locale, theme, reading, comparison, nativeAX: true });
  }
  writeFileSync(join(output, 'table-accessibility.json'), JSON.stringify(reports, null, 2));
  console.log(`Table accessibility passed: ${reports.length} locale/theme groups, nine distinct sources and comparison regions.`);
  return reports;
};
