const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const { registerShellPanelIpc } = require(join(output, 'panels.cjs'));
process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }));
  for (const mode of ['close', 'destroy', 'dispose-before-close']) {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    const contents = window.webContents;
    await contents.loadURL('data:text/html,<title>Offline panel lifecycle</title>');
    const baseline = contents.listenerCount('input-event');
    const dispose = registerShellPanelIpc(ipcMain, window, {}, () => false);
    assert.equal(contents.listenerCount('input-event'), baseline + 1);
    let cleaned = false, continued = false;
    if (mode === 'dispose-before-close') dispose();
    const closed = new Promise(resolve => window.once('closed', () => {
      assert.equal(window.isDestroyed(), true);
      if (mode !== 'dispose-before-close') dispose();
      cleaned = true;
      assert.equal(contents.listenerCount('input-event'), baseline);
      assert.equal(contents.listenerCount('did-navigate'), 0);
      assert.equal(ipcMain.listenerCount('polyask:set-surface'), 0);
      assert.equal(ipcMain.listenerCount('polyask:set-drawer-open'), 0);
      resolve();
    }));
    window.once('closed', () => { continued = true; });
    boundary();
    if (mode === 'destroy') window.destroy(); else window.close();
    await closed;
    assert.equal(cleaned && continued, true, 'cleanup must not interrupt remaining closed listeners');
    console.log(JSON.stringify({ mode, cleaned, continued }));
  }
  boundary();
  console.log('PANEL_LIFECYCLE_COMPLETE');
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
