const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
// Prevent inherited developer measurement flags from touching existing files.
for (const key of ['POLYASK_SOAK_REPORT', 'POLYASK_DIAGNOSTICS_FILE', 'POLYASK_WINDOW_TRACE',
  'POLYASK_RESOURCE_TRACE', 'POLYASK_IDLE_THROTTLING_EXPERIMENT']) delete process.env[key];
const { startRuntimeGates, registerSiteHealthIpc, runtimeProcessDiagnostics, buildSiteReport } = require(join(output, 'production.cjs'));
let shellWindow, untrustedWindow, gates, stopIpc;
let code = 0;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, cb) => cb({ cancel: true }));
  const options = { show: false, webPreferences: { sandbox: true, contextIsolation: true,
    nodeIntegration: false, preload: join(output, 'preload.cjs') } };
  shellWindow = new BrowserWindow(options);
  untrustedWindow = new BrowserWindow(options);
  gates = startRuntimeGates(shellWindow);
  stopIpc = registerSiteHealthIpc({ manager: {}, trusted: event =>
    event.sender === shellWindow.webContents && event.senderFrame === shellWindow.webContents.mainFrame });
  await shellWindow.loadFile(join(output, 'shell.html'));
  await untrustedWindow.loadFile(join(output, 'shell.html'));
  assert.deepEqual(await shellWindow.webContents.executeJavaScript('window.polyask.getRuntimeProcessFailures()'), []);
  // Synthetic native event checks production wiring; no process is crashed.
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'launch-failed', exitCode: 5,
    systemErrorCode: 5, name: 'private account', serviceName: 'https://private.invalid' });
  const failures = await shellWindow.webContents.executeJavaScript('window.polyask.getRuntimeProcessFailures()');
  assert.deepEqual(failures, [{ processType: 'GPU', reason: 'launch-failed', exitCode: 5, systemErrorCode: 5 }]);
  assert.equal(await untrustedWindow.webContents.executeJavaScript('window.polyask.getRuntimeProcessFailures().then(()=>false,e=>e.message.includes("untrusted_sender"))'), true);
  const report = buildSiteReport({ version: 'synthetic', distribution: 'test', platform: process.platform,
    scale: 1, sites: [], statuses: {}, health: {}, now: 0, processFailures: failures });
  assert.match(report, /runtime \[GPU\]: reason=launch-failed exitCode=5 systemErrorCode=5/);
  assert.doesNotMatch(report, /private|https/);
  const count = app.listenerCount('child-process-gone');
  gates.dispose(); gates = null;
  assert.equal(app.listenerCount('child-process-gone'), count - 1);
  assert.deepEqual(runtimeProcessDiagnostics.snapshot(), []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ electron: process.versions.electron,
    scope: 'Synthetic native event, production runtime gates/preload/IPC, isolated offline windows; no real GPU crash.',
    checks: ['trusted shell', 'untrusted sender rejected', 'safe fields only', 'report inclusion', 'listener cleanup'] }, null, 2));
  console.log('Runtime process smoke passed: trusted bridge, safe fields, copied report and listener cleanup.');
}).catch(error => { console.error(error); code = 1; }).finally(() => {
  stopIpc?.(); gates?.dispose();
  for (const win of [shellWindow, untrustedWindow]) if (win && !win.isDestroyed()) win.destroy();
  app.exit(code);
});
