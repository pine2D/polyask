const { app, BrowserWindow, session, webContents } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
// Window recreation stays in one app instance, matching macOS' window lifecycle.
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (condition, label) => {
  const deadline = Date.now() + 8000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await pause(30);
  }
};
app.whenReady().then(async () => {
  const { ViewManager, startPaintRecovery, SITES } = require(join(output, 'services.cjs'));
  const sample = processBoundary(app, output), keys = SITES.map(site => site.key);
  let blocked = 0, destroyed = 0;
  for (const s of [session.defaultSession, session.fromPartition('persist:polyask-sites')]) {
    s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => {
      blocked++; callback({ cancel: true });
    });
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    const previousBlocked = blocked;
    const window = new BrowserWindow({ show: true, width: 1400, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.setMenuBarVisibility(false);
    await window.loadURL('data:text/html,<title>Local lifecycle check</title>');
    const manager = new ViewManager(window, () => {}, () => {}, () => {}, { selectedSites: keys });
    const dispose = startPaintRecovery(window, manager);
    const sites = manager.getDiagnosticSites();
    const contents = sites.map(site => webContents.fromId(site.webContentsId));
    await until(() => blocked >= previousBlocked + 9 && contents.every(c => !c.isLoadingMainFrame()), 'initial loads intercepted');
    const html = marker => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<meta charset="utf-8"><p>${marker}</p><script>window.framesSeen=0;function frame(){window.framesSeen++;requestAnimationFrame(frame)}frame()</script>`);
    for (const [index, c] of contents.entries()) await c.loadURL(html(`initial ${cycle} ${index}`));
    sample();
    assert.equal(sites.length, 9);
    assert.equal(manager.getDiagnosticSites().every(site => site.attached && site.bounds.width > 0 && site.bounds.height > 0), true);
    window.hide();
    await until(() => !window.isVisible(), 'window hidden');
    for (const [index, c] of contents.entries()) await c.loadURL(html(`hidden navigation ${cycle} ${index}`));
    window.show(); window.focus();
    await until(() => window.isVisible(), 'window shown');
    await until(async () => (await Promise.all(contents.map(c => c.executeJavaScript('framesSeen')))).every(n => n >= 2), 'all hidden navigations paint');
    for (let page = 0; page < 3; page++) {
      manager.setPage(page);
      assert.equal(manager.getDiagnosticSites().every(site => site.attached && site.bounds.width > 0 && site.bounds.height > 0), true);
    }
    assert.equal(contents.every(c => c.getBackgroundThrottling() === false), true);
    sample(); dispose(); window.destroy();
    await until(() => contents.every(c => c.isDestroyed()), 'site contents destroyed with window');
    destroyed += contents.filter(c => c.isDestroyed()).length;
  }
  sample();
  writeFileSync(join(output, 'report.json'), JSON.stringify({ electron: process.versions.electron, cycles: 2, sites: 9, destroyed }));
  app.quit();
}).catch(error => { console.error(error.stack || String(error)); app.exit(1); });
