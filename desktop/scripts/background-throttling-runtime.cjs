const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const page = `<!doctype html><textarea>Offline composer</textarea><script>
window.counts = { timer: 0, frame: 0 };
setInterval(() => counts.timer++, 50);
function frame() { counts.frame++; requestAnimationFrame(frame); } frame();
</script>`;
let window;
const views = [];
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => callback({ cancel: true }));
  window = new BrowserWindow({ width: 1000, height: 700, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('data:text/html,<title>Offline background throttling experiment</title>');
  for (let i = 0; i < 3; i++) {
    const view = new WebContentsView({ webPreferences: { sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 50, width: 950, height: 600 });
    await view.webContents.loadURL(`data:text/html,${encodeURIComponent(page)}`);
    views.push(view);
  }
  const read = () => Promise.all(views.map(async view => ({
    allowed: view.webContents.getBackgroundThrottling(),
    ...await view.webContents.executeJavaScript('({ ...counts, visibility: document.visibilityState, width: innerWidth, height: innerHeight })')
  })));
  const phases = [];
  // A/B/A checks reversibility; mixed checks the shared-window interaction.
  for (const [name, allowed] of [['baseline', [false, false, false]], ['all-throttled', [true, true, true]],
    ['mixed', [true, true, false]], ['restored', [false, false, false]]]) {
    window.show();
    views.forEach((view, i) => view.webContents.setBackgroundThrottling(allowed[i]));
    window.hide();
    await pause(1500);
    const before = await read();
    const started = Date.now();
    await pause(3000);
    const after = await read();
    phases.push({ name, elapsedMs: Date.now() - started, sites: after.map((site, i) => ({ ...site,
      timerDelta: site.timer - before[i].timer, frameDelta: site.frame - before[i].frame })) });
    for (const site of after) assert.ok(site.width > 0 && site.height > 0, 'attached views keep nonzero viewport');
  }
  window.show();
  await pause(500);
  const restored = await read();
  assert.ok(restored.every(site => site.allowed === false && site.visibility === 'visible'));
  const report = { schema: 1, platform: process.platform, electron: process.versions.electron,
    scope: 'Synthetic offline pages; hide rather than OS minimize; no memory/energy savings or live-site compatibility claims.', phases };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  if (window && !window.isDestroyed()) window.destroy();
  app.quit();
});
