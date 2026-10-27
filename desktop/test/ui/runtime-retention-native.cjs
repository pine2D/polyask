const { app, BrowserWindow, WebContentsView, session } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], report = [];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
// Finish destruction assertions and write evidence before explicitly quitting.
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (wc, code) => wc.executeJavaScriptInIsolatedWorld(999, [{ code }]);
const fixture = readFileSync(join(__dirname, 'runtime-retention-page.js'), 'utf8');
async function collect(wc) {
  for (let i = 0; i < 4; i++) {
    // Run a renderer task/microtask checkpoint before GC; creating/dereferencing a
    // WeakRef keeps its target alive until that job finishes.
    await evaluate(wc, 'retention.checkpoint()');
    await evaluate(wc, 'gc({type:"major",execution:"async"})');
  }
  assert.equal(await evaluate(wc, '[retention.control, retention.detachedControl].filter(ref => ref.deref() !== undefined).length'),
    0, 'the GC controls must be collected independently of runtime cleanup');
  return evaluate(wc, 'retention.nodes.filter(ref => ref.deref() !== undefined).length');
}
async function snapshotFailure(wc) {
  const chunks = [];
  const receive = (_event, method, params) => { if (method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(params.chunk); };
  wc.debugger.on('message', receive);
  try {
    await wc.debugger.sendCommand('HeapProfiler.takeHeapSnapshot');
    writeFileSync(join(output, 'failure.heapsnapshot'), chunks.join(''));
  } finally { wc.debugger.off('message', receive); }
}
async function prepare(wc, host) {
  await wc.loadURL(`https://${host}/chat/synthetic`);
  await evaluate(wc, fixture);
  assert.equal(await evaluate(wc, 'typeof __AMS.history.snapshot'), 'function');
  assert.equal(await evaluate(wc, 'retention.answerText()'), 'Earlier answer');
}
app.whenReady().then(async () => {
  const sample = processBoundary(app, output);
  const partition = session.fromPartition('runtime-retention-synthetic');
  let pages = 0;
  // All site URLs resolve locally; there are no remote page loads or real accounts.
  await partition.protocol.handle('https', () => {
    pages++;
    return new Response('<!doctype html><meta charset="utf-8"><title>Synthetic retention check</title><body></body>',
      { headers: { 'content-type': 'text/html' } });
  });
  partition.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (_request, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({ width: 1400, height: 900, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const views = ['chatgpt.com', 'chatgpt.com', 'claude.ai'].map((_host, index) => {
    const view = new WebContentsView({ webPreferences: { preload: join(output, 'site-preload.cjs'), session: partition,
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.contentView.addChildView(view); view.setBounds({ x: index * 450, y: 0, width: 450, height: 850 });
    view.webContents.debugger.attach('1.3');
    return view;
  });
  for (const kind of ['route', 'freeze']) {
    const wc = views[0].webContents;
    await prepare(wc, 'chatgpt.com');
    await evaluate(wc, '__AMS.history.begin("run", "Synthetic question", Date.now()); retention.appendTurn()');
    await pause(30);
    const before = await evaluate(wc, '__AMS.history.snapshot("run")');
    assert.equal(before.owned, true); assert.equal(before.text, 'Synthetic answer');
    await evaluate(wc, 'retention.advance(4000)');
    if (kind === 'route') await evaluate(wc, 'dispatchEvent(new PopStateEvent("popstate"))');
    else {
      wc.focus();
      wc.sendInputEvent({ type: 'mouseDown', x: 35, y: 715, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 35, y: 715, button: 'left', clickCount: 1 });
    }
    await pause(30);
    const ended = await evaluate(wc, '__AMS.history.snapshot("run")');
    assert.equal(ended.ended, true);
    assert.equal(ended.captureCode, kind === 'route' ? 'route_changed' : 'interaction');
    if (kind === 'freeze') assert.equal(ended.text, 'Synthetic answer');
    await evaluate(wc, 'retention.track(); document.getElementById("turns").remove()');
    const retained = await collect(wc);
    if (retained) {
      console.log('GC controls:', await evaluate(wc, 'JSON.stringify({object:!!retention.control.deref(), node:!!retention.detachedControl.deref()})'));
      await snapshotFailure(wc);
    }
    assert.equal(retained, 0, `history ${kind}: detached DOM is collectible without a new submission`);
    if (kind === 'freeze') assert.equal(await evaluate(wc, '__AMS.history.snapshot("run").text'), 'Synthetic answer');
    report.push({ kind: `history-${kind}`, retained }); sample();
  }
  for (const [index, host] of [[1, 'chatgpt.com'], [2, 'claude.ai']]) for (const seen of [false, true]) {
    const wc = views[index].webContents;
    await prepare(wc, host);
    await evaluate(wc, 'retention.track(); __AMS.armGeneration()');
    if (seen) { await evaluate(wc, 'retention.showStop(true)'); await pause(30); await evaluate(wc, 'retention.showStop(false)'); }
    assert.equal(await evaluate(wc, '__AMS.generationProbe()'), 'complete', 'the old answer cannot confirm this run');
    await evaluate(wc, 'retention.replaceTurn()');
    await pause(30);
    assert.equal(await evaluate(wc, '__AMS.generationProbe()'), seen ? 'complete_observed' : 'complete');
    const active = await collect(wc);
    assert.equal(active > 0, true, 'active evidence still retains the old baseline');
    await evaluate(wc, 'retention.advance(16 * 60_000)');
    const retained = await collect(wc);
    assert.equal(retained, 0, 'expired generation releases the detached DOM, including after observing Stop');
    assert.equal(await evaluate(wc, '__AMS.generationProbe()'), 'complete');
    report.push({ kind: `generation-${host}-${seen ? 'seen' : 'quiet'}`, active, retained }); sample();
  }
  assert.equal(views.every(view => view.webContents.getBackgroundThrottling() === false), true);
  sample();
  const contents = views.map(view => view.webContents);
  for (const wc of contents) { wc.debugger.detach(); wc.close(); }
  window.destroy();
  await pause(30);
  assert.equal(contents.every(wc => wc.isDestroyed()), true);
  const result = { electron: process.versions.electron, platform: process.platform, pages, scenarios: report,
    clock: 'virtual expiry; real DOM, MutationObserver and Chromium GC', destroyed: views.length };
  writeFileSync(join(output, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.quit();
}).catch(error => { console.error(error.stack || String(error)); app.exit(1); });
