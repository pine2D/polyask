const { app, BrowserWindow, nativeTheme, session } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const output = process.argv[2], cases = [], errors = [];
let win, requests = 0;
app.setPath('userData', join(output, 'profile'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const check = (ok, message) => { if (!ok) throw Error(message); };
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => { requests++; done({ cancel: true }); });
  win = new BrowserWindow({ show: true, width: 1440, height: 1000, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false); win.setContentSize(1440, 1000);
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source), state = { scenario: 'long-reading', step: 'start' };
  const native = nativeReadingTools(win, output, state, run);
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) {
    const zoom = theme === 'dark' ? 2 : 1, density = theme === 'dark' ? 'comfortable' : 'compact';
    nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, density } });
    win.webContents.setZoomFactor(zoom); await native.until('window.u32Post?.total===1000', 'list');
    await native.until(`innerWidth===${1440 / zoom}&&innerHeight===${1000 / zoom}`, 'actual zoom viewport');
    await run(`(() => {const row=[...document.querySelectorAll('[data-action=library-open-item]')].find(e=>e.textContent.includes('Performance result 000'));row.click()})()`);
    await native.until('window.u32Post.completeRead()', 'all nine complete source endings');
    await run('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    boundary();
    const skipped = await run(`(() => {const p=document.querySelector('#archive-answer-8 .markdown-preview p');return !p.checkVisibility({contentVisibilityAuto:true})})()`);
    check(skipped, 'offscreen full source text must not incur layout before reading');
    await native.click('.archive-answer-nav a[href="#archive-answer-8"]');
    check(await run('location.hash==="#archive-answer-8"'), 'source navigation retains its native fragment');
    await native.until(`document.querySelector('.archive-answer-nav a[aria-current=location]')?.getAttribute('href')==='#archive-answer-8'`, 'last source location');
    const jump = await run(`(() => {const r=document.querySelector('#archive-answer-8 h2').getBoundingClientRect(), n=document.querySelector('.library-reading-navigation').getBoundingClientRect();return {top:r.top,bottom:r.bottom,nav:n.bottom,vh:innerHeight}})()`);
    check(jump.top >= jump.nav - 2 && jump.bottom < jump.vh, 'last source heading visible below sticky navigation: ' + JSON.stringify(jump));
    const before = await run('document.querySelector(".archive-detail-pane").scrollTop');
    await native.click('.library-view-switch button:nth-child(2)');
    await native.until('!!document.querySelector(".archive-compare-column")', 'comparison');
    await run(`(()=>{const a=document.querySelectorAll('.archive-compare-column');a[0].scrollTop=1200;a[1].scrollTop=1700;a.forEach(e=>e.dispatchEvent(new Event('scroll')));})()`);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const comparison = await run('[...document.querySelectorAll(".archive-compare-column")].map(e=>e.scrollTop)');
    await native.click('.library-view-switch button:first-child');
    await native.until('window.u32Post.completeRead()', 'back to complete reading');
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const after = await run('document.querySelector(".archive-detail-pane").scrollTop');
    check(Math.abs(after - before) <= 2, `read scroll survives view switch: ${before} → ${after}`);
    await native.click('.library-view-switch button:nth-child(2)');
    await native.until('!!document.querySelector(".archive-compare-column")', 'comparison restored');
    const restored = await run('[...document.querySelectorAll(".archive-compare-column")].map(e=>e.scrollTop)');
    check(restored.every((value, i) => Math.abs(value - comparison[i]) <= 2), `independent comparison scroll restored (${locale}/${theme}): ${comparison} → ${restored}`);
    await native.click('.library-view-switch button:first-child');
    await native.until('window.u32Post.completeRead()', 'find source');
    const found = new Promise(resolve => {
      const listener = (_event, result) => { if (result.finalUpdate) { win.webContents.removeListener('found-in-page', listener); resolve(result.matches); } };
      win.webContents.on('found-in-page', listener);
    });
    win.webContents.findInPage('End of complete answer 0 from chatglm.cn');
    check(await found > 0, 'native find sees complete offscreen source'); win.webContents.stopFindInPage('clearSelection');
    await native.click('.archive-answer-nav a[href="#archive-answer-0"]');
    await native.until(`document.querySelector('.archive-answer-nav a[aria-current=location]')?.getAttribute('href')==='#archive-answer-0'`, 'first source location');
    const complete = await run('window.u32Post.completeRead()'); check(complete, 'find and source jumps do not remove any text');
    if (locale === 'zh-CN' && theme === 'light') {
      await native.click('.archive-answer-nav a[href="#archive-answer-8"]');
      await native.until(`document.querySelector('.archive-answer-nav a[aria-current=location]')?.getAttribute('href')==='#archive-answer-8'`, 'source before closing library');
      const remembered = await run('document.querySelector(".archive-detail-pane").scrollTop');
      await native.click('.library-close'); await native.until('!document.querySelector(".library")', 'library closed');
      await run('window.u32Post.reopen()'); await native.until('window.u32Post.completeRead()', 'library reopened');
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const reopened = await run('document.querySelector(".archive-detail-pane").scrollTop');
      check(Math.abs(reopened - remembered) <= 2, `library reopen restores long source position: ${remembered} → ${reopened}`);
    }
    writeFileSync(join(output, `reading-${locale}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    cases.push({ locale, theme, zoom, density, skipped, jump, before, after, comparison, restored, complete });
  }
  check(errors.length === 0 && requests === 0, 'no renderer errors or network');
  boundary(); writeFileSync(join(output, 'report.json'), JSON.stringify({ cases, requests, errors }, null, 2));
  console.log('Long reading evidence: ' + output); win.destroy(); app.quit();
}).catch(async error => {
  console.error(String(error));
  if (win && !win.isDestroyed()) { writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); win.destroy(); }
  app.exit(1);
});
