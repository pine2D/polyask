const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({ win, nativeTheme, output, run, wait, click, key, shot }) => {
  const reports = [];
  const read = fn => run('(' + fn.toString() + ')()');
  const paint = () => run('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  for (const [locale, theme, width, height, zoom, longTitles] of [
    ['zh-CN', 'light', 1600, 900, 1, false], ['en', 'dark', 960, 900, 1, false],
    ['zh-TW', 'light', 1280, 900, 1.25, false], ['zh-CN', 'dark', 960, 600, 1, true],
    ['en', 'light', 1600, 900, 2, false], ['zh-TW', 'dark', 640, 900, 1, false]
  ]) {
    win.webContents.setZoomFactor(1); win.setContentSize(width, height); nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, ...(longTitles ? { longTitles: '1' } : {}) } });
    win.webContents.setZoomFactor(zoom);
    await wait('!!document.querySelector(".archive-detail h1")');
    await click('.library-view-switch button:nth-child(2)');
    await wait('!!document.querySelector(".comparison-manual-entry")');
    await paint();
    const geometry = await read(function() {
      const pane = document.querySelector('.archive-detail-pane'), columns = [...document.querySelectorAll('.archive-compare-column')];
      const box = pane.getBoundingClientRect(), first = columns[0].getBoundingClientRect();
      const entry = document.querySelector('.comparison-manual-entry').getBoundingClientRect();
      return { paneBottom:box.bottom, firstTop:first.top, firstBottom:first.bottom,
        available:box.bottom-first.top-16, limit:parseFloat(getComputedStyle(columns[0]).maxHeight),
        outerOverflow:pane.scrollHeight-pane.clientHeight, sideBySide:Math.abs(columns[0].getBoundingClientRect().top-columns[1].getBoundingClientRect().top)<1,
        width:innerWidth, bodyWidth:document.documentElement.scrollWidth,
        entryVisible:entry.top >= box.top && entry.bottom <= box.bottom,
        lengths:columns.map(column=>column.textContent.length) };
    });
    if (geometry.available >= 160) {
      assert.ok(geometry.firstBottom <= geometry.paneBottom - 14, 'answer fits the actual remaining pane height');
      assert.equal(geometry.entryVisible, true);
      if (geometry.sideBySide) assert.ok(geometry.outerOverflow <= 1, 'two answer columns fit without a third scrolling surface');
    } else assert.equal(geometry.limit, 160, 'short viewports retain the reading floor and outer scrolling');
    assert.ok(geometry.bodyWidth <= geometry.width + 1);
    assert.ok(geometry.lengths.every(length => length > 500));
    if (locale === 'zh-CN') await shot('comparison-viewport-' + (longTitles ? 'short' : 'wide'));
    const position = await read(function() {
      const columns = [...document.querySelectorAll('.archive-compare-column')], pane = document.querySelector('.archive-detail-pane');
      columns[0].scrollTop = 240; columns[1].scrollTop = 360; pane.scrollTop += 100;
      return columns.map(column=>column.scrollTop);
    });
    await paint();
    assert.equal(await read(function() { return parseFloat(getComputedStyle(document.querySelector('.archive-compare-column')).maxHeight); }), geometry.limit);
    win.setContentSize(width, height + 80); await paint();
    const restored = await read(function() {
      return [...document.querySelectorAll('.archive-compare-column')].map(column=>({top:column.scrollTop,max:column.scrollHeight-column.clientHeight}));
    });
    restored.forEach((column, index) => assert.ok(Math.abs(column.top - Math.min(position[index], column.max)) <= 1, 'resize keeps valid answer positions'));
    await click('.comparison-manual-entry');
    await wait('document.querySelector(".manual-comparison")?.open && document.activeElement === document.querySelector(".manual-comparison summary")');
    assert.equal(await run('document.querySelector(".archive-compare-grid").hidden'), true);
    await click('.comparison-manual-entry');
    await wait('!document.querySelector(".archive-compare-grid").hidden');
    const returned = await read(function() { return [...document.querySelectorAll('.archive-compare-column')].map(column=>column.scrollTop); });
    returned.forEach((top,index) => assert.ok(Math.abs(top-restored[index].top) <= 1, 'worksheet switching preserves answer positions'));
    if (locale === 'en' && zoom === 1) {
      await read(function() { document.querySelector('.comparison-manual-entry').focus(); });
      await key('Return');
      await wait('document.activeElement === document.querySelector(".manual-comparison summary")');
    }
    assert.equal(await run('window.libraryTest.writes'), 0);
    reports.push({locale,theme,width,height,zoom,longTitles,geometry,positions:restored});
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600,1000); nativeTheme.themeSource = 'light';
  await win.loadFile(join(output,'index.html')); await wait('!!document.querySelector(".archive-detail h1")');
  console.log('Comparison viewport passed: ' + reports.length + ' layout and worksheet-entry groups.');
  return reports;
};
