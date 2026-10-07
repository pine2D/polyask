const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const output = process.argv[2];
const evidence = process.argv[3];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1200, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.focus(); win.webContents.focus();
  if (evidence) mkdirSync(evidence, { recursive: true });
  let failed = false;
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    for (const width of [1200, 640]) {
      win.setSize(width, 900);
      await win.loadFile(join(output, 'index.html'), { query: { locale } });
      const result = await win.webContents.executeJavaScript('window.inputProtectionResult');
      console.log(JSON.stringify({ locale, width, ...result }));
      if (evidence) writeFileSync(join(evidence, `${locale}-${width}.png`), (await win.webContents.capturePage()).toPNG());
      if (!result.ok) failed = true;
    }
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
