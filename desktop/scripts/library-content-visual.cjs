const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({ win, nativeTheme, output, run, wait, click, shot }) => {
  const reports = [];
  for (const [locale, theme, width, zoom] of [
    ['zh-CN', 'light', 1600, 1], ['zh-CN', 'dark', 1280, 1.5],
    ['zh-TW', 'light', 960, 1.25], ['zh-TW', 'dark', 1600, 1],
    ['en', 'light', 1600, 2], ['en', 'dark', 960, 1]
  ]) {
    win.webContents.setZoomFactor(1); win.setContentSize(width, 1000); nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, longTitles: '1' } });
    win.webContents.setZoomFactor(zoom);
    await wait(`Math.abs(innerWidth-${width / zoom}) <= 1 && !!document.querySelector('.archive-detail h1') && document.querySelectorAll('.library-item-title').length === 9`);
    await run('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    const list = await run(`(() => [...document.querySelectorAll('.library-content-row')].map(row => {
      const title = row.querySelector('.library-item-title'), style = getComputedStyle(title), box = title.getBoundingClientRect();
      const button = row.querySelector('[data-action=library-open-item]'), source = row.querySelector('.library-item-sources');
      const time = row.querySelector('time').getBoundingClientRect(), bounds = button.getBoundingClientRect();
      return { length:title.textContent.length, complete:title.textContent === title.title, height:box.height,
        lineHeight:parseFloat(style.lineHeight), overflow:style.overflowY, scrollHeight:title.scrollHeight,
        sourceTop:source?.getBoundingClientRect().top, sourceBottom:source?.getBoundingClientRect().bottom,
        titleBottom:box.bottom, timeTop:time.top, timeBottom:time.bottom, buttonBottom:bounds.bottom,
        rowWidth:row.clientWidth, rowScroll:row.scrollWidth };
    }))()`);
    assert.equal(list.length, 9);
    for (const item of list) {
      assert.ok(item.length > 80 && item.complete, 'fixture retains complete long titles of both record types');
      assert.ok(item.overflow !== 'visible' && item.height <= item.lineHeight * 2 + 1,
        `title paints within two lines: ${JSON.stringify({ locale, theme, zoom, ...item })}`);
      assert.ok((item.sourceTop ?? item.timeTop) >= item.titleBottom + 4 && item.timeTop >= (item.sourceBottom ?? item.titleBottom) + 4,
        'source totals and time have separate visible rows below the clipped title');
      assert.ok(item.timeBottom <= item.buttonBottom && item.rowScroll <= item.rowWidth + 1, 'metadata remains inside its row without horizontal overflow');
    }
    if (locale === 'zh-CN') await shot(`library-long-titles-${theme}`);
    const complete = await run(`(() => { const row=document.querySelector('.library-content-row:has([aria-current=true])');
      return row.querySelector('.library-item-title').title; })()`);
    await click('[data-action=library-open-item][aria-current=true]');
    await wait(`document.querySelector('.archive-detail h1')?.textContent === ${JSON.stringify(complete)}`);
    await click('.library-view-switch button:nth-child(2)');
    await wait('!!document.querySelector(".archive-compare-paragraph")');
    const comparison = await run(`(() => {
      const blocks=[...document.querySelectorAll('.archive-compare-paragraph')], rules=[...document.querySelectorAll('.archive-compare-column .markdown-preview hr')];
      return { blocks:blocks.length, addedRules:blocks.filter(block=>parseFloat(getComputedStyle(block).borderBottomWidth)>0).length,
        originalRules:rules.length, originalRulesVisible:rules.every(rule=>parseFloat(getComputedStyle(rule).borderTopWidth)>0),
        common:blocks.filter(block=>block.dataset.relation==='shared').length,
        sharedHighlight:blocks.filter(block=>block.dataset.relation==='shared').every(block=>getComputedStyle(block).boxShadow!=='none'),
        writes:window.libraryTest.writes };
    })()`);
    assert.ok(comparison.blocks > 10 && comparison.common > 0 && comparison.sharedHighlight, 'full comparison and shared-paragraph cues remain');
    assert.equal(comparison.addedRules, 0, 'comparison does not add a horizontal rule to every block');
    assert.equal(comparison.originalRules, 2, 'original Markdown separators remain in both answers');
    assert.equal(comparison.originalRulesVisible, true);
    assert.equal(comparison.writes, 0);
    if (locale === 'zh-CN') await shot(`comparison-without-added-rules-${theme}`);
    reports.push({ locale, theme, width, zoom, titles:list.length, comparison });
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600, 1000); nativeTheme.themeSource = 'light';
  await win.loadFile(join(output, 'index.html'));
  await wait('!!document.querySelector(".archive-detail h1")');
  console.log(`Library content passed: ${reports.length} long-title and comparison-layout groups.`);
  return reports;
};
