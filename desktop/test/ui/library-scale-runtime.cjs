const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativePerformance } = require('./native-performance.cjs');
const output = process.argv[2];
const only = process.argv[3] || '';
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, label) => { if (!value) throw Error(label); };
async function until(win, expression) {
  const deadline = Date.now() + 8_000;
  while (!await win.webContents.executeJavaScript(expression)) {
    check(Date.now() < deadline, 'native UI timeout: ' + expression); await pause(25);
  }
}
async function click(win, expression) {
  const box = await win.webContents.executeJavaScript(`(()=>{const n=${expression};if(!n)return null;
    n.scrollIntoView({block:'center',inline:'nearest'});const r=n.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,visible:!!n.getClientRects().length&&!n.disabled};})()`);
  check(box && box.visible && box.width >= 24 && box.height >= 24, 'native click target ' + expression + ': ' + JSON.stringify(box));
  const point = { x: Math.round(box.x), y: Math.round(box.y) };
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(30);
}
const q = selector => `document.querySelector(${JSON.stringify(selector)})`;
const action = name => q(`[data-action="library-${name}"]`);
async function key(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause(25);
}
async function browse(win) {
  if (await win.webContents.executeJavaScript("innerWidth<761&&document.querySelector('.library').dataset.pane==='detail'"))
    await click(win, q('.folder-back-list'));
}
async function page(win, edge) {
  await browse(win); await click(win, q('[name="library-page"]'));
  await key(win, edge); await key(win, 'Enter');
  await until(win, `!${q('[name="library-page"]')}.getAttribute('aria-expanded')||${q('[name="library-page"]')}.getAttribute('aria-expanded')==='false'`);
}
async function run(win, locale, width) {
  await until(win, "window.libraryScale&&document.querySelectorAll('.library-item-title').length===100&&!document.querySelector('.archive-list').getAttribute('aria-busy').includes('true')");
  check(await win.webContents.executeJavaScript("document.querySelector('.library-pagination').textContent.includes('1000')"), 'complete result count is visible');
  await browse(win); await click(win, q('[name="library-search"]'));
  const queryCount = await win.webContents.executeJavaScript('window.libraryScale.queries.length');
  const searched = nativePerformance(app, '1000-record-search-input-to-ready');
  await key(win, 'A', [process.platform === 'darwin' ? 'meta' : 'control']); await key(win, 'Backspace');
  await win.webContents.insertText('Sky');
  await until(win, `window.libraryScale.queries.length>${queryCount}&&window.libraryScale.queries.at(-1).query==='Sky'&&document.querySelector('[name=library-search]').value==='Sky'&&document.querySelector('.archive-list').getAttribute('aria-busy')==='false'`);
  const samples = [searched()];
  check(await win.webContents.executeJavaScript("document.querySelector('.archive-detail-heading h1').textContent==='Sky result 0000'"), 'matching query preserves the reader');
  await page(win, 'End');
  await until(win, "[...document.querySelectorAll('.library-item-title')].at(-1)?.textContent==='Sky decision 999'");
  check(await win.webContents.executeJavaScript("document.querySelectorAll('.library-item-title').length===100"), 'final page remains bounded');
  const opened = nativePerformance(app, '1000-record-last-decision-click-to-ready');
  await click(win, "[...document.querySelectorAll('[data-action=library-open-item]')].at(-1)");
  await until(win, "document.querySelector('.decision-workspace')"); samples.push(opened()); await browse(win);
  await click(win, action('select-page'));
  await until(win, "document.querySelectorAll('.library-content-row input:checked').length===100");
  check(await win.webContents.executeJavaScript("document.querySelector('[data-action=library-bulk-favorite]').disabled"), 'mixed page cannot favorite decision cards');
  await click(win, action('previous-page'));
  await until(win, "document.querySelectorAll('.library-content-row input:checked').length===0");
  await click(win, q('.library-content-row .library-row-check'));
  await until(win, "document.querySelector('.library-selection-summary').textContent.includes('101')");
  await click(win, action('clear-selection')); await page(win, 'Home');
  await until(win, "document.querySelector('.library-item-title').textContent==='Sky result 0000'");
  await click(win, q('.library-content-row:nth-child(1) .library-row-check'));
  await key(win, 'Space'); await until(win, "document.querySelectorAll('.library-content-row input:checked').length===0");
  await key(win, 'Space'); await until(win, "document.querySelectorAll('.library-content-row input:checked').length===1");
  await click(win, q('.library-content-row:nth-child(2) .library-row-check'));
  await until(win, "document.querySelectorAll('.library-content-row input:checked').length===2");
  await click(win, action('bulk-favorite'));
  await until(win, 'window.libraryScale.writes.length===1&&window.libraryScale.blocked');
  check(await win.webContents.executeJavaScript("window.libraryScale.blockingAtWrite[0]===true&&document.querySelector('.library-close').disabled&&document.querySelector('[name=library-search]').disabled"), 'blocking precedes IPC and disables close and search');
  check(await win.webContents.executeJavaScript("window.libraryScale.command('away')===false&&!document.querySelector('#library-other-surface')"), 'parent command refuses to leave during pending write');
  await click(win, action('bulk-stop'));
  await win.webContents.executeJavaScript('window.libraryScale.finish()');
  await until(win, '!window.libraryScale.blocked&&document.querySelector(".archive-list").getAttribute("aria-busy")==="false"');
  check(await win.webContents.executeJavaScript("window.libraryScale.writes.length===1&&document.querySelector('.library-bulk-result').textContent.includes('1')&&!document.querySelector('.library-close').disabled"), 'stop settles one request without starting the next');
  await click(win, action('clear-selection'));
  const box = await win.webContents.executeJavaScript("(()=>{const n=document.querySelector('.archive-list');const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);window.libraryNativeWheel=null;window.libraryWheelBox={x,y,width:r.width,height:r.height,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight,overflowY:getComputedStyle(n).overflowY,hitInside:!!hit&&n.contains(hit),hover:n.matches(':hover')};document.addEventListener('wheel',event=>{window.libraryNativeWheel={trusted:event.isTrusted,hitInside:n===event.target||n.contains(event.target),deltaY:event.deltaY,defaultPrevented:event.defaultPrevented,x:event.clientX,y:event.clientY};},{once:true,capture:true});return window.libraryWheelBox;})()");
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(box.x), y: Math.round(box.y), deltaY: -420, deltaX: 0, canScroll: true });
  await until(win, "document.querySelector('.archive-list').scrollTop>50");
  const scroll = await win.webContents.executeJavaScript("document.querySelector('.archive-list').scrollTop");
  check(await win.webContents.executeJavaScript("window.libraryScale.command('away')===true"), 'settled parent command accepts navigation');
  await until(win, "document.querySelector('#library-other-surface')");
  const returned = nativePerformance(app, 'library-return-click-to-ready');
  await click(win, q('#library-return'));
  await until(win, "document.querySelectorAll('.library-item-title').length===100&&document.querySelector('.archive-list').getAttribute('aria-busy')==='false'");
  samples.push(returned());
  check(await win.webContents.executeJavaScript("document.querySelector('[name=library-search]').value==='Sky'&&document.querySelector('.decision-workspace')&&document.querySelectorAll('.library-content-row input:checked').length===0"), 'return restores query and fresh reader without bulk selection');
  check(await win.webContents.executeJavaScript(`Math.abs(document.querySelector('.archive-list').scrollTop-${scroll})<=2`), 'return restores actual wheel scroll');
  check(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1'), 'library does not widen the window');
  writeFileSync(join(output, `${locale}-${width}.png`), (await win.webContents.capturePage()).toPNG());
  if (locale === 'zh-TW' && width === 640) {
    win.webContents.setZoomFactor(1.5); win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await pause(50); check(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1'), '150 percent forced-colors stays contained');
    writeFileSync(join(output, 'zh-TW-640-forced-150.png'), (await win.webContents.capturePage()).toPNG());
  }
  return { locale, width, ok: true, total: 1000, bounded: true, keyboardLast: true, matchingReader: true,
    explicitSelection: true, keyboardCheckbox: true, pendingParentCommand: true, stopSettlesOne: true, sessionWheelScroll: true, samples };
}
app.whenReady().then(async () => {
  let requests = 0;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { requests++; callback({ cancel: true }); });
  const report = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const width of [1200, 640]) {
    if (only && only !== `${locale}:${width}`) continue;
    const win = new BrowserWindow({ width, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    try {
      await win.loadFile(join(output, 'index.html'), { query: { locale } }); win.focus(); report.push(await run(win, locale, width));
    } catch (error) {
      const diagnostics = await win.webContents.executeJavaScript("({rows:document.querySelectorAll('.library-item-title').length,page:document.querySelector('[name=library-page]')?.textContent??'',pane:document.querySelector('.library')?.dataset.pane??'',blocked:window.libraryScale?.blocked??false,writes:window.libraryScale?.writes.length??0,scroll:document.querySelector('.archive-list')?.scrollTop??0,wheelBox:window.libraryWheelBox??null,wheel:window.libraryNativeWheel??null,innerWidth,scrollWidth:document.documentElement.scrollWidth})").catch(() => ({}));
      writeFileSync(join(output, `${locale}-${width}-failed.png`), (await win.webContents.capturePage()).toPNG());
      report.push({ locale, width, ok: false, error: String(error), diagnostics });
    } finally { win.destroy(); }
  }
  const scope = only ? `targeted:${only}` : 'full-six';
  writeFileSync(join(output, 'report.json'), JSON.stringify({ scope, report, requests }));
  console.log(JSON.stringify({ artifact: output, scope, report, requests }));
  app.exit(report.length === (only ? 1 : 6) && report.every(item => item.ok) && requests === 0 ? 0 : 1);
}).catch(error => { console.error(String(error)); app.exit(1); });
