const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  let failed = false;
  for (const scenario of ['source-links', 'ime-composing', 'ime-229', 'back', 'escape', 'menu-tab', 'menu-shift-tab', 'close', 'switch', 'delete', 'pages', 'slow-list', 'slow-detail']) {
    await win.loadFile(join(output, 'index.html'), { query: { scenario } });
    if (scenario === 'source-links') {
      await win.webContents.executeJavaScript('(async()=>{while(!window.historyNativeReady) await new Promise(resolve=>setTimeout(resolve,20))})()');
      let error = '';
      for (const [shift, selector, description] of [
        [false, '.markdown-preview a[href="https://example.com/first"]', 'toolbar Tab reaches the first source'],
        [false, '.markdown-preview a[href="https://example.com/second"]', 'next Tab reaches the second source'],
        [false, '.question-header button', 'last source Tab wraps to the header'],
        [true, '.markdown-preview a[href="https://example.com/second"]', 'header Shift+Tab reaches the last source'],
        [true, '.markdown-preview a[href="https://example.com/first"]', 'source Shift+Tab follows native reverse order'],
        [true, '.question-prompt-actions button[aria-haspopup="menu"]', 'first source Shift+Tab returns to the toolbar']
      ]) {
        const modifiers = shift ? ['shift'] : [];
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
        await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 40))');
        const ok = await win.webContents.executeJavaScript(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`);
        if (!ok) {
          const active = await win.webContents.executeJavaScript('({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label"), text: document.activeElement?.textContent?.slice(0,80) })');
          error = `${description}: ${JSON.stringify(active)}`; break;
        }
      }
      await win.webContents.executeJavaScript(`window.historyNativeError = ${JSON.stringify(error)}; window.historyNativeDone = true`);
    }
    if (scenario.startsWith('menu-')) {
      await win.webContents.executeJavaScript('(async()=>{while(!window.historyTabReady) await new Promise(resolve=>setTimeout(resolve,20))})()');
      const modifiers = scenario === 'menu-shift-tab' ? ['shift'] : [];
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers });
    }
    const result = await win.webContents.executeJavaScript('window.historyResult');
    console.log(JSON.stringify({ scenario, ...result }));
    if (!result.ok) failed = true;
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
