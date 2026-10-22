const { app, BrowserWindow, WebContentsView, session, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { processBoundary } = require('./native-process-boundary.cjs');

const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
const preload = process.argv[3], workerPreload = process.argv[4];
require(join(output, 'web-badging.cjs')).disableWebBadging(app, workerPreload);
const sample = processBoundary(app, output);
const inspect = `({set:typeof navigator.setAppBadge,clear:typeof navigator.clearAppBadge,secure:isSecureContext,
  locked:['setAppBadge','clearAppBadge'].every(key=>{const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),key);return !d||(!d.configurable&&!d.writable)}),
  node:typeof require,process:typeof process})`;
const html = `<!doctype html><script>window.initialBadge = ${inspect}</script><input id="composer"><button onclick="window.sent=document.querySelector('input').value">Send</button>`;
const handler = (request, response) => {
  response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/html');
  if (request.url === '/sw.js') response.end(`const initialBadge=${inspect};self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('message',event=>event.waitUntil((async()=>{await navigator.setAppBadge(3);await navigator.clearAppBadge();event.ports[0].postMessage(initialBadge)})()));`);
  else if (request.url === '/worker.js') response.end(`postMessage(${inspect})`);
  else if (request.url === '/shared.js') response.end(`onconnect=event=>event.ports[0].postMessage(${inspect})`);
  else response.end(html);
};
const servers = [createServer(handler), createServer(handler)];
let window;
async function main() {
  await app.whenReady();
  sample();
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
  const origins = servers.map(server => `http://127.0.0.1:${server.address().port}`);
  const siteSession = session.fromPartition('persist:badging-check');
  siteSession.setPermissionCheckHandler(() => false);
  siteSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const view = new WebContentsView({ webPreferences: { session: siteSession, preload,
    sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  const contents = view.webContents;
  const preloadErrors = [];
  contents.on('preload-error', (_event, _path, error) => {
    preloadErrors.push(error.message);
    console.error('Preload failed:', error.message);
  });
  await contents.loadURL(origins[0]);
  const cases = { page: await contents.executeJavaScript('window.initialBadge') };
  for (const [name, origin] of [['sameOriginFrame', origins[0]], ['crossOriginFrame', origins[1]]]) {
    await contents.executeJavaScript(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(origin + '/frame')};frame.onload=()=>resolve();document.body.append(frame)})`);
    const frame = contents.mainFrame.frames.find(frame => frame.url === origin + '/frame');
    assert.equal(frame !== undefined, true, `${name} loaded`);
    cases[name] = await frame.executeJavaScript('window.initialBadge');
  }
  cases.worker = await contents.executeJavaScript(`new Promise((resolve,reject)=>{const worker=new Worker('/worker.js');worker.onmessage=e=>{worker.terminate();resolve(e.data)};worker.onerror=reject})`);
  cases.sharedWorker = await contents.executeJavaScript(`new Promise((resolve,reject)=>{const worker=new SharedWorker('/shared.js');worker.port.onmessage=e=>{worker.port.close();resolve(e.data)};worker.onerror=reject})`);
  cases.serviceWorker = await contents.executeJavaScript(`(async()=>{await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready;return new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data)};registration.active.postMessage('inspect',[channel.port2])})})()`);
  const reloaded = new Promise(resolve => contents.once('did-finish-load', resolve));
  contents.reload();
  await reloaded;
  cases.reload = await contents.executeJavaScript('window.initialBadge');
  const behavior = await contents.executeJavaScript(`(async()=>{await navigator.setAppBadge(2);await navigator.clearAppBadge();document.querySelector('input').value='synthetic question';document.querySelector('button').click();return{sent:window.sent,notification:typeof Notification}})()`);
  if (preload.includes('.webpack')) {
    const response = new Promise(resolve => ipcMain.once('polyask:site-response', (_event, result) => resolve(result)));
    contents.send('polyask:site-command', { requestId: 'badge-check', command: { source: 'AMS', cmd: 'generation' } });
    assert.equal((await response).requestId, 'badge-check', 'production site command bridge remains connected');
    behavior.siteBridge = true;
  }
  sample();
  writeFileSync(join(output, 'report.json'), JSON.stringify({ cases, behavior, preloadErrors }, null, 2));
  assert.equal(preloadErrors.length, 0, 'preloads load without error');
  for (const [name, value] of Object.entries(cases)) {
    assert.equal(value.secure, true, `${name}: use a secure context so the test cannot pass because of HTTP restrictions`);
    const expected = ['worker', 'sharedWorker'].includes(name) ? 'undefined' : 'function';
    assert.equal(value.set, expected, `${name}: keep compatible badge calls`);
    assert.equal(value.clear, expected, `${name}: keep compatible badge calls`);
    assert.equal(value.locked, true, `${name}: native badge methods must be replaced before page scripts`);
    assert.equal(value.node, 'undefined', `${name}: no Node access`);
    assert.equal(value.process, 'undefined', `${name}: no process access`);
  }
  assert.equal(behavior.sent, 'synthetic question', 'ordinary page scripts and input still work');
  assert.equal(behavior.notification, 'function', 'notification capability is not disabled by the badge policy');
  console.log('WEB_BADGING_NATIVE_COMPLETE');
}
main().then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  if (window && !window.isDestroyed()) window.destroy();
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  app.exit(code);
}
