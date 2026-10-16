const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({win,nativeTheme,output,run,wait,click,key,shot}) => {
  const reports = [];
  const read = fn => run('(' + fn.toString() + ')()');
  const paint = () => run('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  for (const [locale,theme,width,zoom] of [
    ['zh-CN','light',1600,1],['en','dark',960,1],['zh-TW','light',1280,1.25],
    ['zh-CN','dark',1280,1.5],['en','light',1600,2],['zh-TW','dark',640,1]
  ]) {
    win.webContents.setZoomFactor(1); win.setContentSize(width,900); nativeTheme.themeSource = theme;
    await win.loadFile(join(output,'index.html'),{query:{locale}});
    win.webContents.setZoomFactor(zoom);
    await wait('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href") === "#archive-answer-0"');
    const sizes = await read(function() {
      const nav = document.querySelector('.archive-answer-nav');
      return {height:nav.getBoundingClientRect().height,widths:[...nav.querySelectorAll('a')].map(link=>link.getBoundingClientRect().width)};
    });
    await click('.archive-answer-nav a[href="#archive-answer-4"]');
    await wait('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href") === "#archive-answer-4"');
    const focused = await read(function() {
      const pane=document.querySelector('.archive-detail-pane'); pane.scrollTop+=120;
      return document.activeElement?.getAttribute('href');
    });
    await paint();
    assert.equal(await run('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href")'), '#archive-answer-4');
    assert.equal(await run('document.activeElement?.getAttribute("href")'), focused, 'passive reading does not move focus');
    await click('.archive-answer-nav a[href="#archive-answer-8"]');
    await wait('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href") === "#archive-answer-8"');
    await click('#archive-answer-8 .archive-answer-actions button:first-child');
    await click('.archive-answer-nav a[href="#archive-answer-8"]');
    await wait('!!document.querySelector(".archive-answer-nav a[data-best=true][aria-current=location]")');
    const marked = await read(function() {
      const nav=document.querySelector('.archive-answer-nav'), current=nav.querySelector('[aria-current=location]');
      return {height:nav.getBoundingClientRect().height,widths:[...nav.querySelectorAll('a')].map(link=>link.getBoundingClientRect().width),
        underline:getComputedStyle(current).textDecorationLine, writes:window.libraryTest.writes};
    });
    assert.equal(marked.height,sizes.height); assert.deepEqual(marked.widths,sizes.widths);
    assert.equal(marked.underline.includes('underline'),true); assert.equal(marked.writes,1);
    if(locale==='zh-CN') await shot('source-location-'+theme);
    await read(function() { document.querySelector('.archive-answer-nav a[href="#archive-answer-8"]').focus(); });
    await key('Return'); await paint();
    assert.equal(await run('document.querySelectorAll(".archive-answer-nav [aria-current=location]").length'),1);
    await click('#archive-answer-8 .archive-answer-actions button:first-child');
    await click('.archive-answer-nav a[href="#archive-answer-8"]'); await paint();
    assert.equal(await run('document.querySelectorAll(".archive-answer-nav [data-best=true]").length'),0);
    assert.equal(await run('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href")'),'#archive-answer-8');
    assert.equal(await run('window.libraryTest.writes'),2,'reading never adds a save beyond explicit mark/unmark');
    reports.push({locale,theme,width,zoom,marked});
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600,1000); nativeTheme.themeSource='light';
  await win.loadFile(join(output,'index.html')); await wait('!!document.querySelector(".archive-detail h1")');
  console.log('Current source passed: '+reports.length+' source-location and best-answer groups.');
  return reports;
};
