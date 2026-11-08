const { app, BrowserWindow, session, webContents } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { processBoundary } = require('./native-process-boundary.cjs');
const { distribution } = require('./resource-baseline-metrics.cjs');
const output = process.argv[2], build = process.argv[3];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (fn, label, timeout = 4000) => {
  const deadline = Date.now() + timeout;
  while (!await fn()) { if (Date.now() >= deadline) throw Error(`state_unconfirmed:${label}`); await pause(30); }
};
const pageHtml = index => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Bounded ${index}</title><pre></pre><script>
window.state={generation:false,ticks:0,frames:0};
const pre=document.querySelector('pre');
setInterval(()=>{if(state.generation){state.ticks++;pre.textContent=('Synthetic token '+state.ticks+'\\n').repeat(256)}},50);
function frame(){state.frames++;requestAnimationFrame(frame)}frame();
</script>`);
app.whenReady().then(async () => {
  const { ViewManager, startPaintRecovery, SITES } = require(join(build, 'services.cjs'));
  const report = { kind: 'synthetic-native-pages', versions: process.versions, platform: process.platform, arch: process.arch,
    note: 'CPU interval samples and per-process working sets, never exclusive-memory sums; bounded 20Hz text simulation, not genuine AI generation', rows: [] };
  let blocked = 0, destroyed = 0;
  const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify({ ...report, blocked, destroyed }, null, 2));
  // Intercept initial production site navigation locally; no requests leave the isolated session.
  for (const s of [session.defaultSession, session.fromPartition('persist:polyask-sites')]) {
    s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, cb) => { blocked++; cb({ cancel: true }); });
  }
  const boundary = processBoundary(app, output);
  for (const count of [1, 3, 9]) {
    const win = new BrowserWindow({ show: true, width: 1400, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.setMenuBarVisibility(false); await win.loadURL('data:text/html,<title>Synthetic shell</title>');
    const manager = new ViewManager(win, () => {}, () => {}, () => {}, { selectedSites: SITES.slice(0, count).map(s => s.key) });
    const dispose = startPaintRecovery(win, manager), sites = manager.getDiagnosticSites();
    assert.equal(sites.length, count);
    const contents = sites.map(s => webContents.fromId(s.webContentsId));
    await until(() => contents.every(c => !c.isLoadingMainFrame()), 'blocked initial navigation');
    for (const [index, c] of contents.entries()) await c.loadURL(pageHtml(index));
    const snapshot = async () => ({ visible: win.isVisible(), minimized: win.isMinimized(), focused: win.isFocused(),
      attached: manager.getDiagnosticSites().filter(s => s.attached).length, pages: await Promise.all(contents.map(async c => ({
        id: c.id, loading: c.isLoadingMainFrame(), throttled: c.getBackgroundThrottling(),
        ...await c.executeJavaScript('({...state,visibility:document.visibilityState,focused:document.hasFocus(),bytes:document.querySelector("pre").textContent.length})') }))) });
    const measure = async name => {
      await until(() => contents.every(c => !c.isLoadingMainFrame()), 'synthetic page settled');
      boundary(); const before = await snapshot();
      writeFileSync(join(output, 'latest-state.json'), JSON.stringify(before));
      assert.equal(before.pages.length, count); assert.equal(before.pages.every(s => !s.loading && !s.throttled), true);
      // Same warmup semantics as native-performance.cjs: discard the initial CPU baseline call.
      app.getAppMetrics(); const samples = [], operations = [];
      for (let i = 0; i < 5; i++) {
        await pause(300);
        samples.push(app.getAppMetrics().map(m => ({ pid: m.pid, type: m.type, cpuPercent: m.cpu.percentCPUUsage,
          workingSetKiB: m.memory.workingSetSize })));
        const start = performance.now(); manager.setPage(i % Math.ceil(count / 3));
        await contents[0].executeJavaScript('document.querySelector("pre").dataset.operation=String((+document.querySelector("pre").dataset.operation||0)+1)');
        operations.push(performance.now() - start);
      }
      const after = await snapshot();
      if (before.pages[0].generation) assert.equal(after.pages.every((s, i) => s.ticks > before.pages[i].ticks), true);
      report.rows.push({ count, state: name, confirmed: true, before, after, sampleIntervalMs: 300, samples,
        operation: 'production setPage plus first-page JS DOM acknowledgement; main-clock', operationMs: distribution(operations),
        perProcess: [...new Set(samples.flatMap(s => s.map(p => p.pid)))].map(pid => {
          const values = samples.flatMap(s => s.filter(p => p.pid === pid));
          return { pid, type: values[0].type, cpuPercent: distribution(values.map(p => p.cpuPercent)),
            workingSetKiB: distribution(values.map(p => p.workingSetKiB)) };
        }) }); save();
    };
    win.show(); win.focus(); win.webContents.focus();
    await until(() => win.isVisible() && !win.isMinimized(), 'foreground visible'); await measure('foreground-idle');
    for (const [i, c] of contents.entries()) {
      await c.executeJavaScript('state.generation=true'); manager.markStatus({ site: sites[i].site, phase: 'generating' });
    }
    win.hide(); await until(() => !win.isVisible() && !win.isFocused(), 'hidden background'); await measure('hidden-generation-simulation');
    win.show(); win.focus(); await until(() => win.isVisible(), 'shown before minimize');
    win.minimize();
    const deadline = Date.now() + 1200;
    while (!win.isMinimized() && Date.now() < deadline) await pause(30);
    if (win.isMinimized()) {
      await measure('minimized-generation-simulation');
      const start = performance.now(); win.restore(); win.show(); win.focus();
      await until(() => !win.isMinimized() && win.isVisible(), 'restored');
      report.rows.push({ count, state: 'restore-transition', confirmed: true, elapsedMs: performance.now() - start });
      await measure('restored-generation-simulation');
    } else {
      report.rows.push({ count, state: 'minimize-restore', confirmed: false,
        reason: 'minimize() called; isMinimized() remained false after 1200ms; cause unisolated', observed: await snapshot() }); save();
      win.restore(); win.show(); win.focus(); await measure('shown-generation-after-unconfirmed-minimize');
    }
    dispose(); win.destroy(); await until(() => contents.every(c => c.isDestroyed()), 'production lifecycle destroyed');
    destroyed += count; boundary(); save(); console.log(`Native page baseline ${count}: destroyed and boundary checked`);
  }
  assert.equal(destroyed, 13); save(); app.exit(0);
}).catch(error => { writeFileSync(join(output, 'failure.txt'), String(error.stack)); console.error(error.stack); app.exit(1); });
