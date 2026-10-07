const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  let failed = false;
  for (const scenario of ['back', 'escape', 'menu-tab', 'menu-shift-tab', 'close', 'switch', 'delete', 'pages', 'slow-list', 'slow-detail']) {
    await win.loadFile(join(output, 'index.html'), { query: { scenario } });
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
