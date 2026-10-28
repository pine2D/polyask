const { app, BrowserWindow, session, nativeTheme, dialog, ipcMain } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), { join } = require('node:path');
const output = process.argv[2], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', join(output, 'profile')); app.setPath('sessionData', join(output, 'profile', 'session'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
let activeWindow;
const renderSaved = path => new (require('markdown-it'))().render(fs.readFileSync(path, 'utf8'));
const report = { clicks: [], cases: [], files: [], cancelled: 0, refreshed: 0, network: 0, errors: [] };
app.whenReady().then(async () => {
  const { prepareMarkdownNativeData, registerMarkdownExportIpc } = require(join(output, 'services.cjs'));
  const fixture = prepareMarkdownNativeData(); let cancelNext = false, chosen;
  // Only the OS chooser response is controlled. Production preload, trusted IPC, SQLite reads and atomic file writes run unchanged.
  dialog.showSaveDialog = async (_window, options) => {
    assert.equal(options.filters[0].extensions[0], 'md');
    if (cancelNext) { cancelNext = false; report.cancelled++; return { canceled: true }; }
    chosen = join(output, `${report.files.length}-${options.defaultPath}`); return { canceled: false, filePath: chosen };
  };
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => { report.network++; cb({ cancel: true }); });
  const win = new BrowserWindow({ width: 1200, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, preload: join(output, 'preload.cjs') } });
  activeWindow = win; win.setMenuBarVisibility(false);
  win.webContents.on('console-message', details => { if (details.level === 'error') report.errors.push(details.message); });
  const unregister = registerMarkdownExportIpc({ ...fixture.repositories, window: win,
    trusted: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame,
    epoch: () => fixture.db.questions.lifecycle, isCurrent: () => !win.isDestroyed() });
  ipcMain.handle('polyask:bootstrap', () => fixture.data);
  const run = expression => win.webContents.executeJavaScript(`(() => { const q=s=>document.querySelector(s), f=window.markdownFixture;
    const byLabel=label=>[...document.querySelectorAll('button')].find(n=>n.textContent===label);return (${expression});})()`);
  const until = async (expression, label) => {
    const end = Date.now() + 5000;
    while (!await run(expression)) { if (Date.now() > end) throw Error(`Timeout: ${label}`); await pause(20); }
  };
  const click = async expression => {
    await until(`!!(${expression})&&!(${expression}).disabled`, expression);
    const point = await run(`(()=>{const node=${expression};node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    report.clicks.push({expression, point, hit: await run(`(()=>{const n=document.elementFromPoint(${point.x},${point.y});return {tag:n?.tagName,className:n?.className,label:n?.getAttribute('aria-label'),checked:n?.checked};})()`) });
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) });
    await pause(60);
  };
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers }); await pause(70);
  };
  const open = async (locale, theme, zoom, mode = 'history') => {
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(zoom === 1 ? 1200 : 960, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, mode } }); win.webContents.setZoomFactor(zoom); win.focus(); win.webContents.focus();
    await until("f?.ready&&document.hasFocus()&&(q('.question-main')||q('.archive-list[aria-busy=false]'))", 'fixture ready'); boundary();
  };
  const save = async () => {
    await click('byLabel(f.copy.markdownSaveOne)'); await until("!q('.markdown-export-panel')", 'saved');
    assert.equal(fs.existsSync(chosen), true); report.files.push(chosen); return renderSaved(chosen);
  };
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) for (const zoom of [1, 1.5, 2]) {
    await open(locale, theme, zoom);
    await click('byLabel(f.copy.markdownSelect)'); await click("q('.question-selection input')"); await click('byLabel(f.copy.markdownMerge)');
    await until("q('.markdown-export-record')&&!q('.markdown-export-scroll[aria-busy=true]')", 'loaded selection');
    await click("q('.markdown-export-entry:has(select[aria-label^=Claude]) input')"); assert.equal(await run("byLabel('Claude').getAttribute('aria-pressed')"), 'mixed');
    await click("byLabel('Claude')"); assert.equal(await run("byLabel('Claude').getAttribute('aria-pressed')"), 'true');
    await click("byLabel('Claude')"); assert.equal(await run("byLabel('ChatGPT').getAttribute('aria-pressed')"), 'true');
    await run('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    const geometry = await run(`(()=>{const panel=q('.markdown-export-panel'),footer=q('.markdown-export-footer'),scroll=q('.markdown-export-scroll'),r=panel.getBoundingClientRect(),b=footer.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,footerBottom:b.bottom,scrollHeight:scroll.clientHeight,overflow:panel.scrollWidth>panel.clientWidth+1||scroll.scrollWidth>scroll.clientWidth+1};})()`);
    report.lastGeometry = { locale, theme, zoom, geometry };
    assert.equal(geometry.overflow, false); assert.equal(geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.top >= 0 && geometry.footerBottom <= geometry.height + 1, true);
    assert.equal(geometry.scrollHeight > 40, true, 'scrollable choices must remain usable');
    const name = `${locale}-${theme}-${zoom}`;
    fs.writeFileSync(join(output, name + '.png'), (await win.capturePage()).toPNG());
    // Tab stays inside the modal even when its list is longer than the viewport.
    await run("q('.markdown-export-footer .primary').focus()"); await key('Tab');
    assert.equal(await run("document.activeElement===q('.markdown-export-panel header button')"), true);
    cancelNext = true; await click('byLabel(f.copy.markdownSaveOne)');
    await until("q('.markdown-export-footer').textContent.includes(f.copy.markdownCancelled)", 'cancel notice');
    assert.equal(await run("byLabel('Claude').getAttribute('aria-pressed')"), 'false');
    const text = await save(); assert.match(text, /CHATGPT_q-0_2/); assert.equal(text.includes('CLAUDE_q-0'), false);
    assert.match(text, locale === 'zh-CN' ? /导出时间/ : locale === 'zh-TW' ? /匯出時間/ : /Exported at/);
    await click('byLabel(f.copy.markdownMerge)'); await until("!!q('.markdown-export-record')", 'reopen'); await key('Escape');
    assert.equal(await run("!q('.markdown-export-panel')&&document.activeElement===byLabel(f.copy.markdownMerge)"), true);
    assert.equal(await run('f.keys.every(e=>e.trusted)'), true); report.cases.push({ locale, theme, zoom, geometry }); boundary();
  }
  await open('en', 'light', 1); await click("q('.question-main')"); await until("!!q('.question-reader-actions')", 'reader');
  await click('byLabel(f.copy.markdownSingle)'); await until("!byLabel(f.copy.markdownSingle).disabled&&!!document.querySelector('[role=status]')", 'single history');
  assert.equal(fs.existsSync(chosen), true); assert.match(renderSaved(chosen), /CLAUDE_q-0_2/); report.files.push(chosen);
  await open('en', 'light', 1, 'library'); await until("!!q('[data-action=archive-answer-export]')", 'library answer');
  await click("q('[data-action=archive-answer-export]')"); await until("q('.archive-workspace .archive-status').textContent===f.copy.markdownSaved", 'single archive');
  assert.match(renderSaved(chosen), /ARCHIVE_CLAUDE_0/); assert.equal(renderSaved(chosen).includes('ARCHIVE_CHATGPT_0'), false); report.files.push(chosen);
  await click("q('[data-action=archive-markdown-export]')"); await until("!!q('.markdown-export-record')", 'whole archive');
  assert.equal(await run("q('.markdown-export-panel').textContent.includes(f.copy.markdownSynthesis)"), true); await key('Escape');
  assert.equal(await run("document.activeElement===q('[data-action=archive-markdown-export]')"), true);
  await open('en', 'light', 1, 'bulk'); await click("q('[data-action=library-multi-select]')"); await click("q('[data-action=library-select-page]')"); await click("q('[data-action=library-bulk-export]')");
  await until("document.querySelectorAll('.markdown-export-record').length===3", 'mixed library selection');
  const merged = await save(); assert.match(merged, /ARCHIVE_CLAUDE_0/); assert.match(merged, /ARCHIVE_CHATGPT_1/); assert.match(merged, /DECISION_CONCLUSION/);
  await open('en', 'dark', 2);
  await click('byLabel(f.copy.markdownSelect)'); await click("q('.question-selection input')"); await click('byLabel(f.copy.markdownMerge)');
  await until("document.querySelectorAll('.markdown-export-record').length===3", 'refresh source selection');
  fixture.db.questions.delete('q-0', 9999, 'synthetic');
  await click('byLabel(f.copy.markdownSaveOne)'); await until("!!q('.markdown-export-error')", 'deleted-source error');
  await click('byLabel(f.copy.markdownRefresh)');
  await until("document.querySelectorAll('.markdown-export-record').length===2&&!byLabel(f.copy.markdownSaveOne).disabled", 'refresh recovered');
  assert.equal(await run("q('.markdown-export-footer').textContent.includes(f.copy.markdownRemoved.replace('{count}', '1'))"), true);
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await run("q('.markdown-export-footer').getBoundingClientRect().bottom<=innerHeight+1&&q('.markdown-export-scroll').clientHeight>40"), true);
  fs.writeFileSync(join(output, 'en-dark-2-refreshed.png'), (await win.capturePage()).toPNG());
  const refreshed = await save(); assert.match(refreshed, /CLAUDE_q-1_2/); assert.equal(refreshed.includes('CLAUDE_q-0'), false); report.refreshed++;
  assert.equal(report.network, 0); boundary(); unregister(); fixture.db.close();
  fs.writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(`MARKDOWN_NATIVE_COMPLETE ${report.cases.length} layouts, ${report.files.length} files`);
  win.destroy(); app.quit();
}).catch(async error => { if (activeWindow && !activeWindow.isDestroyed()) { fs.writeFileSync(join(output,'failure.png'), (await activeWindow.capturePage()).toPNG()); } console.error(error.stack); fs.writeFileSync(join(output, 'failure.json'), JSON.stringify({ report, error: String(error) }, null, 2)); app.exit(1); });
