const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], report = { cases: [], errors: [], network: 0 };
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
let win, tools;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    report.network++; callback({ cancel: true });
  });
  win = new BrowserWindow({ width: 1400, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message.slice(0, 150)); });
  const state = { scenario: 'stars', step: 'load', lastInput: null };
  tools = nativeReadingTools(win, output, state);
  const { js, click, key, until, check } = tools, boundary = processBoundary(app, output);
  const cases = ['history', 'library'].flatMap(surface => ['en', 'zh-CN', 'zh-TW'].flatMap(locale =>
    ['light', 'dark'].flatMap(theme => [640, 1400].map(width => ({ surface, locale, theme, width, zoom: 1 })))));
  cases.push(...['history', 'library'].map(surface => ({ surface, locale: 'zh-CN', theme: 'dark', width: 960, zoom: 2 })));
  for (const value of cases) {
    const { surface, locale, theme, width, zoom } = value;
    state.step = `${surface}-${locale}-${theme}-${width}-${zoom}`;
    win.setSize(width, 900); nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, surface } });
    win.webContents.setZoomFactor(zoom);
    const row = surface === 'history' ? '.question-list [data-star-button]' : '.library-content-row [data-star-button]';
    const count = surface === 'history' ? '.question-main' : '[data-action=library-open-item]';
    await until(`document.querySelectorAll(${JSON.stringify(row)}).length >= 8`, 'rows available');
    await js('new Promise(resolve => setTimeout(resolve, 180))');
    boundary();
    check(win.webContents.getZoomFactor() === zoom, 'actual zoom');
    if (zoom > 1) check(await js('window.innerWidth') < width / 1.5, 'zoom changes CSS viewport');
    const extra = locale === 'en' && theme === 'light' && width === 1400;
    if (extra) {
      await js('window.starsFixture.fail()'); await click(row);
      check(await js(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-pressed')==='true'`), 'failed save keeps star');
      check(await js('document.querySelector(".star-error")?.textContent===window.starsFixture.labels.starSaveFailed'), 'visible failure');
    }
    await click(row);
    check(await js(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-pressed')==='false'`), 'row click removes star');
    check(await js('!document.querySelector(".question-reader,.archive-detail-heading")'), 'star does not open record');
    await key('Space');
    check(await js(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-pressed')==='true'`), 'keyboard adds star');
    check(await js(`document.activeElement===document.querySelector(${JSON.stringify(row)})`), 'focus stays on star');
    if (extra) {
      const before = await js('window.starsFixture.calls()');
      await js('window.starsFixture.hold()'); await click(row); await key('Space');
      check(await js('window.starsFixture.calls()') === before + 1, 'single flight');
      check(await js(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-pressed')==='true'`), 'pending keeps acknowledged state');
      await js('window.starsFixture.release()');
      await until(`document.querySelector(${JSON.stringify(row)}).getAttribute('aria-pressed')==='false'`, 'save settles');
      await key('Space');
    }
    if (locale === 'zh-CN' && theme === 'light') writeFileSync(join(output, `${state.step}-all.png`), (await win.webContents.capturePage()).toPNG());
    await click('[data-star-filter]');
    await until(`document.querySelectorAll(${JSON.stringify(count)}).length===${surface === 'history' ? 1 : 2}`, 'starred filter');
    const geometry = await js(`(()=>{const root=document.querySelector(${JSON.stringify(surface === 'history' ? '.question-history' : '.library')}),
      buttons=[...root.querySelectorAll('[data-star-button],[data-star-filter]')].filter(n=>n.checkVisibility({checkOpacity:true}));
      return {overflow:root.scrollWidth>root.clientWidth+1,buttons:buttons.map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n),svg=n.querySelector('svg');
        return {width:r.width,height:r.height,right:r.right,fill:getComputedStyle(svg).fill,pressed:n.getAttribute('aria-pressed'),color:s.color};})};})()`);
    check(!geometry.overflow, 'surface does not overflow');
    check(geometry.buttons.every(b => b.width >= 28 && b.height >= 28), 'star targets remain usable');
    check(geometry.buttons.filter(b => b.pressed === 'true').every(b => b.fill === b.color), 'filled stars convey selection');
    writeFileSync(join(output, `${state.step}.png`), (await win.webContents.capturePage()).toPNG());
    if (extra) {
      await click(count);
      const reader = surface === 'history' ? '.question-reader' : '.archive-detail-pane';
      const detailStar = surface === 'history' ? '.question-reader [data-star-button]' : '.archive-detail-actions .star-button';
      await until(`!!document.querySelector(${JSON.stringify(detailStar)})`, 'detail star');
      if (surface === 'history') {
        await until('!!document.querySelector(".question-answer .markdown-preview")', 'actual saved answer body is readable');
        check(await js('Math.abs(document.querySelector(".question-reader [data-star-button]").getBoundingClientRect().top-document.querySelector("[data-action=copy-question]").getBoundingClientRect().top)<3'), 'star shares the record action row');
      }
      await js(`window.starReader=document.querySelector(${JSON.stringify(reader)}); window.starReader.scrollTop=90;`);
      const scroll = await js('window.starReader.scrollTop');
      check(scroll > 50, 'reader has genuinely scrolled content');
      // The native click scrolls a control into view if necessary; compare after positioning, before the write.
      await js(`document.querySelector(${JSON.stringify(detailStar)}).focus({preventScroll:true});`);
      await key('Space');
      await until(`document.querySelector(${JSON.stringify(detailStar)}).getAttribute('aria-pressed')==='false'`, 'detail star removed');
      check(await js(`document.querySelector(${JSON.stringify(reader)})===window.starReader`), 'reader remains mounted');
      check(await js('window.starReader.scrollTop') === scroll, 'reader retains scroll');
      writeFileSync(join(output, `${surface}-reader-after-unstar.png`), (await win.webContents.capturePage()).toPNG());
      if (surface === 'library') {
        await until('document.querySelectorAll("[data-action=library-open-item]").length===1', 'only starred decision remains');
        await click('[data-action=library-open-item]');
        await until('!!document.querySelector(".decision-detail-actions [data-star-button]")', 'decision detail star');
        await click('.decision-detail-actions [data-star-button]');
        await until('document.querySelector(".decision-detail-actions [data-star-button]")?.getAttribute("aria-pressed")==="false"', 'decision unstar acknowledged');
        check(await js('!!document.querySelector(".decision-workspace")'), 'unstar keeps decision readable');
        await click('[data-star-filter]');
        await until('document.querySelectorAll("[data-action=library-open-item]").length===9', 'all records return');
        await click('[data-action=library-multi-select]'); await click('[data-action=library-select-page]');
        await click('[data-action=library-bulk-favorite]');
        await until('document.querySelectorAll(".library-content-row [data-star-button][aria-pressed=true]").length===9', 'mixed bulk stars all kinds');
      }
    }
    report.cases.push({ ...value, geometry, ok: true });
  }
  boundary(); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  win.destroy(); app.exit(0);
}).catch(async error => {
  if (tools) await tools.failure(error);
  console.error(error.stack); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  app.exit(1);
});
