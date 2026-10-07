const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1100, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  let failed = false;
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    const result = await win.webContents.executeJavaScript('window.readingResult');
    console.log(JSON.stringify(result));
    if (!result.ok) failed = true;
    if (locale === 'zh-CN') {
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      writeFileSync('/tmp/polyask-reading-ui-review.png', (await win.webContents.capturePage()).toPNG());
    }
    for (const width of [640, 420]) {
      win.setSize(width, 1000);
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const narrow = await win.webContents.executeJavaScript('window.historyToolbarLayout()');
      console.log(JSON.stringify({ locale, ...narrow }));
      if (width === 420 && !narrow.wrapped) throw Error('compact toolbar must wrap by action group');
      if (locale === 'zh-TW' && width === 420) writeFileSync('/tmp/polyask-history-toolbar-narrow.png', (await win.webContents.capturePage()).toPNG());
    }
    win.setSize(1100, 1000);
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
