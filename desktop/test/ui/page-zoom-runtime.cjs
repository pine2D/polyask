const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2], cases = [], failures = [], errors = [];
let network = 0, win, peer, dispose, layouts = 0;
app.setPath('userData', join(output, 'profile'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const production = require(join(output, 'production.cjs'));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => { network++; done({ cancel: true }); });
  win = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { preload: join(output, 'preload.cjs'), sandbox: true, contextIsolation: true } });
  win.setMenuBarVisibility(false);
  peer = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await peer.loadURL('data:text/html,<p>Synthetic AI page</p>');
  peer.webContents.setZoomMode('isolated'); peer.webContents.setZoomFactor(0.9);
  const relayout = () => { layouts++; };
  dispose = production.registerPageZoomIpc(ipcMain, win.webContents,
    event => event.sender.id === win.webContents.id && event.senderFrame?.parent === null && event.senderFrame.url.startsWith('file:'), relayout);
  const manager = { owns: () => null, relayout, getLayout: () => ({ focused: 'claude' }), isConfirmationActive: () => false,
    reload: () => false, siteZoom: { step: () => { throw Error('reading zoom reached a site'); } } };
  Menu.setApplicationMenu(Menu.buildFromTemplate(production.applicationMenu(process.platform, production.COPY.en,
    production.DEFAULT_DISPLAY_PREFERENCES, () => {}, () => {}, 'PolyAsk',
    action => production.runViewMenuAction(action, manager, win.webContents, win.webContents))));
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => { const end = Date.now() + 6000; while (Date.now() < end) { if (await run(source)) return; await pause(35); } throw Error('wait:' + source); };
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const paint = () => run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const click = async selector => {
    await paint();
    const point = await run(`(() => {const e=document.querySelector(${JSON.stringify(selector)}), r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const factor = win.webContents.getZoomFactor(), p = { x: Math.round(point.x * factor), y: Math.round(point.y * factor), button: 'left', clickCount: 1, modifiers: [] };
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p }); win.webContents.sendInputEvent({ type: 'mouseUp', ...p }); await pause(60);
  };
  const key = async (keyCode, modifiers = ['control']) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause(70);
  };
  const factor = async expected => {
    await wait(`document.querySelector('.page-zoom-reset')?.textContent === '${Math.round(expected * 100)}%'`);
    check(Math.abs(win.webContents.getZoomFactor() - expected) < 0.001, `native factor ${expected}`);
    await paint();
    check(Math.abs(await run('innerWidth') - win.getContentSize()[0] / expected) <= 1,
      `actual viewport scales with ${expected}, not just the percentage label`);
  };
  try {
    for (const surface of ['library', 'history']) {
      win.setContentSize(1280, 800); win.webContents.setZoomFactor(1);
      await win.loadFile(join(output, 'index.html'), { query: { surface } });
      await wait('!!document.querySelector(".page-zoom-in:not(:disabled)")');
      if (surface === 'history') { await wait('!!document.querySelector(".question-main")'); await click('.question-main'); }
      await wait('!!document.querySelector(".markdown-preview p")');
      await run('window.savedReader=document.querySelector(".markdown-preview")');
      await click('.page-zoom-in'); await factor(1.1);
      await key('='); await factor(1.25);
      await key('-'); await factor(1.1);
      await key('0'); await factor(1);
      await key('+', ['control', 'shift']); await factor(1.1);
      await click('.page-zoom-reset'); await factor(1);
      const beforeWheel = layouts;
      win.focus(); win.webContents.focus();
      require('./ctrl-wheel.cjs')(win, 'in');
      await factor(1.1); await pause(100);
      check(layouts === beforeWheel + 1, surface + ': one wheel gesture changes zoom once');
      require('./ctrl-wheel.cjs')(win, 'out'); await factor(1);
      Menu.getApplicationMenu().getMenuItemById('view:zoom-in').click(); await factor(1.1);
      await click('.page-zoom-out'); await factor(1);
      check(await run('window.savedReader === document.querySelector(".markdown-preview")'), surface + ': reader remains mounted');
      check(Math.abs(peer.webContents.getZoomFactor() - 0.9) < 0.001, surface + ': AI site zoom remains independent');
      await click('.page-zoom-in'); await factor(1.1);
      const next = surface === 'library' ? 'history' : 'library';
      await win.loadFile(join(output, 'index.html'), { query: { surface: next } });
      await factor(1.1);
      cases.push({ surface, inputs: 'buttons, Ctrl+=/+/−/0, wheel, native menu', sharedFactor: 1.1 });
    }
    for (const surface of ['library', 'history']) for (const locale of ['zh-CN', 'zh-TW', 'en'])
      for (const theme of ['light', 'dark']) for (const width of [1280, 960]) {
        nativeTheme.themeSource = theme; win.setContentSize(width, 800); win.webContents.setZoomFactor(1);
        await win.loadFile(join(output, 'index.html'), { query: { surface, locale } });
        await wait('!!document.querySelector(".page-zoom-in:not(:disabled)")');
        if (surface === 'history') { await wait('!!document.querySelector(".question-main")'); await click('.question-main'); }
        await wait('!!document.querySelector(".markdown-preview p")');
        for (let i = 0; i < 5; i++) await click('.page-zoom-in');
        await factor(2);
        const measure = await run(`(() => { const control = document.querySelector('.page-zoom'), r = control.getBoundingClientRect();
          const close = document.querySelector('.library-close,.question-header .panel-close').getBoundingClientRect();
          return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth,
            controlsVisible:r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight&&close.right<=innerWidth+1,
            text:document.querySelector('.page-zoom-reset').textContent,body:!!document.querySelector('.markdown-preview p')}; })()`);
        check(measure.overflow <= 1 && measure.controlsVisible && measure.body, `${surface}/${locale}/${theme}/${width}: ${JSON.stringify(measure)}`);
        if (locale === 'zh-CN') writeFileSync(join(output, `${surface}-${theme}-${width}-200.png`), (await win.webContents.capturePage()).toPNG());
        await click('.page-zoom-reset'); await factor(1);
        cases.push({ surface, locale, theme, physicalWidth: width, zoom: 2, ...measure });
      }
    for (const action of ['in', 'out']) {
      for (let i = 0; i < 20; i++) await run(`window.polyask.changePageZoom('${action}')`);
      await factor(action === 'in' ? 5 : 0.25);
      check(await run(`document.querySelector('.page-zoom-${action}').disabled`), action + ': limit button is disabled');
      await key('0'); await factor(1);
    }
    cases.push({ boundary: '25%–500%, reset keyboard remains reachable' });
  } catch (error) {
    failures.push(error.stack || String(error));
    writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    failures.push(await run(`JSON.stringify({zoom:document.querySelector('.page-zoom-reset')?.textContent,width:innerWidth,active:document.activeElement?.className})`));
  }
  finally {
    boundary();
    win.destroy(); peer.destroy(); dispose();
    writeFileSync(join(output, 'report.json'), JSON.stringify({ cases, failures, errors, network, layouts }, null, 2));
    app.exit(failures.length || errors.length || network ? 1 : 0);
  }
});
