const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({ win, nativeTheme, output, run, wait, click, key, shot }) => {
  const reports = [];
  const read = fn => run('(' + fn.toString() + ')()');
  const paint = () => run('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  for (const [locale, theme, width, height, zoom] of [
    ['zh-CN', 'light', 960, 680, 1], ['zh-CN', 'dark', 1600, 900, 1],
    ['zh-TW', 'light', 1280, 720, 1.25], ['zh-TW', 'dark', 960, 680, 1],
    ['en', 'light', 960, 680, 1.5], ['en', 'dark', 1600, 900, 1]
  ]) {
    win.webContents.setZoomFactor(1); win.setContentSize(width, height); nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, longTitles: '1' } });
    win.webContents.setZoomFactor(zoom);
    await wait('document.querySelector(".archive-question-prompt button")?.getAttribute("aria-expanded") === "false"');
    await paint();
    const preview = await read(function() {
      const heading = document.querySelector('.archive-detail h1'), pane = document.querySelector('.archive-detail-pane');
      return { full: heading.textContent, height: heading.clientHeight, fullHeight: heading.scrollHeight,
        line: parseFloat(getComputedStyle(heading).lineHeight), firstAnswer: document.querySelector('.archive-answer').getBoundingClientRect().top,
        paneBottom: pane.getBoundingClientRect().bottom, overflow: pane.scrollWidth > pane.clientWidth + 1 };
    });
    assert.equal(preview.full.length, 145, 'covers the Chinese question below the old 180-character threshold');
    assert.ok(preview.height <= preview.line * 3 + 1 && preview.fullHeight > preview.height + 1, 'preview is at most three real lines');
    assert.equal(preview.overflow, false);
    if (zoom === 1) assert.ok(preview.firstAnswer < preview.paneBottom, 'first saved answer is visible in the initial viewport');
    await read(function() { document.querySelector('.archive-question-prompt button').focus(); });
    await key('Return'); await paint();
    assert.equal(await run('document.querySelector(".archive-question-prompt button").getAttribute("aria-expanded")'), 'true');
    assert.equal(await run('document.querySelector(".archive-detail h1").textContent'), preview.full);
    assert.ok(await run('document.querySelector(".archive-detail h1").clientHeight') > preview.height + 1);

    // A keyboard action on the heading above the reader must retain the visible answer.
    const anchor = await read(function() {
      const pane = document.querySelector('.archive-detail-pane'); pane.scrollTop = 700;
      document.querySelector('.archive-question-prompt button').focus({ preventScroll: true });
      return document.querySelector('.archive-answer').getBoundingClientRect().top;
    });
    await key('Return'); await paint();
    const after = await run('document.querySelector(".archive-answer").getBoundingClientRect().top');
    assert.ok(Math.abs(after - anchor) <= 2, `collapse preserves answer position: ${anchor} -> ${after}`);

    // Return from both editors to their logical origin, with the original reader state intact.
    await read(function() { document.querySelector('.archive-question-prompt button').click(); });
    for (const origin of ['synthesis', 'follow-up:claude.com']) {
      const selector = `[data-archive-editor="${origin}"]`;
      const before = await run(`(()=>{const pane=document.querySelector('.archive-detail-pane');pane.scrollTop=350;
        document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true});return pane.scrollTop;})()`);
      await key('Return');
      await wait('document.activeElement?.matches(".synthesis-workspace h2")');
      assert.equal(await run('document.querySelector(".archive-detail-pane").scrollTop'), 0);
      assert.equal(await run('document.activeElement.textContent'), await run(`window.libraryTest.copy.${origin === 'synthesis' ? 'synthesisTitle' : 'followUpTitle'}`));
      await key('Tab');
      assert.equal(await run('document.activeElement?.matches(".synthesis-workspace .panel-close")'), true, 'Tab continues into the form controls');
      await key('Return'); await wait('!!document.querySelector(".archive-detail")'); await paint();
      assert.equal(await run(`document.activeElement?.getAttribute('data-archive-editor')`), origin);
      assert.equal(await run('document.querySelector(".archive-detail-pane").scrollTop'), before);
      assert.equal(await run('document.querySelector(".archive-question-prompt button").getAttribute("aria-expanded")'), 'true');
    }
    await read(function() { const pane=document.querySelector('.archive-detail-pane');pane.scrollTop=0; });
    if (locale === 'zh-CN') {
      await read(function() { document.querySelector('.archive-question-prompt button').click(); });
      await paint(); await shot(`reading-question-${theme}`);
    }
    assert.equal(await run('window.libraryTest.writes'), 0, 'reading and focus transitions do not save or rewrite content');
    reports.push({ locale, theme, width, height, zoom, preview, anchorDelta: after - anchor });
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600, 900);
  await win.loadFile(join(output, 'index.html'), { query: { locale: 'en', longTitles: '1' } });
  await wait('!!document.querySelector(".archive-question-prompt button")');
  for (const prefix of ['A complete', 'LongUnbrokenResearchIdentifier', '跨站阅读与研究记录']) {
    const selector = `[data-action=library-open-item]:has(.library-item-title[title^="${prefix}"])`;
    const original = await run(`document.querySelector(${JSON.stringify(selector)}).querySelector('.library-item-title').title`);
    await click(selector);
    await wait(`document.querySelector('.archive-detail h1')?.textContent === ${JSON.stringify(original)} && !!document.querySelector('.archive-question-prompt button')`);
    await read(function() { document.querySelector('.archive-question-prompt button').focus(); });
    await key('Return');
    assert.equal(await run('document.querySelector(".archive-question-prompt button").getAttribute("aria-expanded")'), 'true');
    assert.equal(await run('document.querySelector(".archive-detail h1").textContent'), original);
  }
  await win.loadFile(join(output, 'index.html'), { query: { locale: 'en' } });
  await wait('!!document.querySelector(".archive-detail h1")'); await paint();
  assert.equal(await run('!!document.querySelector(".archive-question-prompt button")'), false, 'short original questions have no disclosure control');
  return reports;
};
