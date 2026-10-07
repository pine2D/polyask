const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2], samples = [], snapshots = [];
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw Error(message); };
let win, deadline, lastInput = null, requests = 0;
const js = source => win.webContents.executeJavaScript(source);
async function until(source) {
  const localDeadline = Math.min(deadline, Date.now() + 5_000);
  while (!await js(source)) { check(Date.now() < localDeadline, 'bounded post condition timeout: ' + source); await pause(15); }
}
const frames = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
async function point(expression) {
  win.focus(); await until('document.hasFocus()');
  const box = await js(`(()=>{const n=${expression};if(!n)return null;n.scrollIntoView({block:'nearest',inline:'nearest'});
    const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    return {x,y,width:r.width,height:r.height,enabled:!n.disabled,hit:n===hit||n.contains(hit)};})()`);
  check(box?.enabled && box.hit && box.width >= 24 && box.height >= 24, 'native post target is visible and at least 24px');
  const zoom = win.webContents.getZoomFactor(); return { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom) };
}
async function nativeClick(expression, prepared) {
  const p = prepared ?? await point(expression);
  await js(`(()=>{const n=${expression};window.u32Click=null;document.addEventListener('click',event=>{
    window.u32Click={trusted:event.isTrusted,hit:n===event.target||n.contains(event.target)};},{once:true});})()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...p });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...p });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...p });
  await until('window.u32Click!==null'); lastInput = await js('window.u32Click');
  check(lastInput.trusted && lastInput.hit, 'native post click must hit its real control');
}
async function mark(expression, eventName) {
  await js(`(()=>{const n=${expression};window.u32Post.start=0;document.addEventListener(${JSON.stringify(eventName)},event=>{
    if(n===event.target||n.contains(event.target))window.u32Post.start=performance.now();},{once:true,capture:true});})()`);
}
async function metrics() {
  const result = await win.webContents.debugger.sendCommand('Performance.getMetrics');
  const values = Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]));
  check(Number.isFinite(values.ThreadTime), 'CDP ThreadTime is required'); return values;
}
async function measure(name, action, ready, keep) {
  check(Date.now() < deadline, 'finite post run exceeded 60 seconds');
  const before = await metrics(), parserBefore = await js('({calls:window.u32Post.parseCalls,long:window.u32Post.longParses,ms:window.u32Post.parseMs})');
  await action(); await until(ready); await frames();
  const view = await js(`({elapsedMs:performance.now()-window.u32Post.start,started:window.u32Post.start>0,
    calls:window.u32Post.parseCalls,long:window.u32Post.longParses,parseMs:window.u32Post.parseMs,
    rows:document.querySelectorAll('.library-content-row').length,total:window.u32Post.total,
    view:document.querySelector('.archive-detail')?.dataset.view??'list',
    readers:document.querySelectorAll('.archive-answers .archive-answer').length,columns:document.querySelectorAll('.archive-compare-column').length,completeRead:window.u32Post.completeRead(),
    hiddenReading:[...document.querySelectorAll('.archive-answers')].filter(n=>n.closest('[hidden]')).reduce((sum,n)=>sum+n.querySelectorAll('*').length,0)})`);
  const after = await metrics(); check(view.started && view.rows <= 100 && view.hiddenReading === 0, 'post structure must retain bounded visible rows and no hidden reading');
  const sample = { scenario: name, elapsedMs: view.elapsedMs, threadCpuMs: (after.ThreadTime - before.ThreadTime) * 1000,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000, scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, parseDelta: view.calls - parserBefore.calls,
    fullBodyParseDelta: view.long - parserBefore.long, parseMs: view.parseMs - parserBefore.ms,
    rows: view.rows, total: view.total, readers: view.readers, columns: view.columns, hiddenReading: view.hiddenReading };
  if (name === 'read-to-compare' || name === 'compare-parent-redraw') check(view.readers === 0 && view.columns === 2 && sample.fullBodyParseDelta === 0, 'compare only renders its two active sources');
  if (name === 'compare-parent-redraw') check(sample.parseDelta === 0, 'unchanged parent redraw adds no Markdown parse');
  if (name === 'nine-long-open' || name === 'nine-long-switch' || name === 'compare-to-read') check(view.readers === 9 && view.completeRead && sample.fullBodyParseDelta === 9, 'reading renders all nine complete long answers through their final source headings');
  if (keep) samples.push(sample);
}
const row = title => `[...document.querySelectorAll('[data-action="library-open-item"]')].find(n=>n.querySelector('.library-item-title')?.textContent===${JSON.stringify(title)})`;
const search = 'document.querySelector("[name=library-search]")';
const switcher = view => `document.querySelector('.library-view-switch button:nth-child(${view === 'read' ? 1 : 2})')`;
const listReady = "document.querySelector('.archive-list')?.getAttribute('aria-busy')==='false'&&document.querySelectorAll('.library-content-row').length===100";
const readReady = title => `document.querySelector('.archive-detail-heading h1')?.textContent===${JSON.stringify(title)}&&document.querySelector('.archive-detail')?.dataset.view==='read'&&document.querySelectorAll('.archive-answer').length===9`;
async function searchSample(query, total, keep) {
  await nativeClick(search);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
  await mark(search, 'input');
  await measure(query === 'cohort-a' ? 'search-narrow' : 'search-broad', async () => {
    await win.webContents.insertText(query);
  }, `window.u32Post.query===${JSON.stringify(query)}&&window.u32Post.total===${total}&&${listReady}`, keep);
}
async function clickSample(name, expression, ready, keep) {
  const p = await point(expression); await mark(expression, 'mousedown');
  await measure(name, () => nativeClick(expression, p), ready, keep);
}
async function snapshot(surface) {
  await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const values = await metrics(), renderer = app.getAppMetrics().find(metric => metric.pid === win.webContents.getOSProcessId());
  const dom = await win.webContents.debugger.sendCommand('Memory.getDOMCounters');
  const counts = await js("({elements:document.querySelectorAll('*').length,detailElements:document.querySelector('.archive-detail')?.querySelectorAll('*').length??0,rows:document.querySelectorAll('.library-content-row').length,readers:document.querySelectorAll('.archive-answer').length,columns:document.querySelectorAll('.archive-compare-column').length})");
  check(renderer, 'renderer RSS snapshot is available');
  snapshots.push({ surface, ...counts, cdpNodes: dom.nodes, jsHeapBytes: values.JSHeapUsedSize, rendererResidentKiB: renderer.memory.workingSetSize });
}
const rank = (values, percentile) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
function summaries() {
  return [...new Set(samples.map(sample => sample.scenario))].map(scenario => {
    const group = samples.filter(sample => sample.scenario === scenario);
    const distribution = field => ({ p50: rank(group.map(sample => sample[field]), .5), p95: rank(group.map(sample => sample[field]), .95) });
    return { scenario, n: group.length, elapsedMs: distribution('elapsedMs'), threadCpuMs: distribution('threadCpuMs'), parseMs: distribution('parseMs'),
      parseDelta: distribution('parseDelta'), fullBodyParseDelta: distribution('fullBodyParseDelta') };
  });
}
app.whenReady().then(async () => {
  deadline = Date.now() + 60_000;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { requests++; callback({ cancel: true }); });
  win = new BrowserWindow({ width: 1600, height: 1000, useContentSize: true, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  nativeTheme.themeSource = 'light';
  const a = 'Performance result 000 cohort-a', b = 'Performance result 001 cohort-a', d = 'Performance decision 000 cohort-a';
  let error = null;
  try {
    await win.loadFile(join(output, 'index.html')); win.webContents.setZoomFactor(1); win.focus();
    await until('window.u32Post&&document.hasFocus()'); await until(listReady);
    check(await js('innerWidth===1600&&innerHeight===1000'), 'post viewport must be 1600 by 1000 CSS pixels');
    win.webContents.debugger.attach('1.3'); await win.webContents.debugger.sendCommand('Performance.enable', { timeDomain: 'threadTicks' });
    for (let round = 0; round < 23; round++) {
      const keep = round >= 3;
      await js('window.u32Post.mount(false)'); await until('!document.querySelector(".library")');
      await measure('list-mount', () => js('window.u32Post.mount(true)'), `window.u32Post.total===1000&&${listReady}`, keep);
      await searchSample('cohort-a', 100, keep); await searchSample('performance', 1000, keep);
      await nativeClick(row(d)); await until(`document.querySelector('.decision-editor h1')?.textContent===${JSON.stringify(d)}`);
      await clickSample('nine-long-open', row(a), readReady(a), keep);
      await clickSample('nine-long-switch', row(b), readReady(b), keep);
      await clickSample('read-to-compare', switcher('compare'), "document.querySelector('.archive-detail')?.dataset.view==='compare'&&document.querySelectorAll('.archive-compare-column').length===2", keep);
      const revision = await js('window.u32Post.parentRevision');
      await measure('compare-parent-redraw', () => js('window.u32Post.redraw()'), `window.u32Post.parentRevision===${revision + 1}`, keep);
      if (round === 22) await snapshot('compare');
      await clickSample('compare-to-read', switcher('read'), readReady(b), keep);
      if (round === 22) await snapshot('read');
    }
    check(samples.length === 160 && requests === 0, 'all eight scenarios complete twenty measured samples with no HTTP');
  } catch (caught) { error = String(caught.message).slice(0, 220); }
  const summary = summaries(), goals = { 'list-mount': 150, 'search-broad': 350, 'nine-long-open': 450, 'nine-long-switch': 350, 'read-to-compare': 250, 'compare-parent-redraw': 80 };
  const targets = Object.entries(goals).map(([scenario, p95TargetMs]) => ({ scenario, p95TargetMs,
    observedP95Ms: summary.find(item => item.scenario === scenario)?.elapsedMs.p95 ?? null,
    met: (summary.find(item => item.scenario === scenario)?.elapsedMs.p95 ?? Infinity) <= p95TargetMs }));
  const report = { ok: !error, error, samples, summary, targets, snapshots, requests, lastInput,
    workload: await js('window.u32Post?.workload??null').catch(() => null),
    environment: { viewport: await js('({width:innerWidth,height:innerHeight})'), zoom: win.webContents.getZoomFactor(), locale: 'zh-CN', theme: 'light', versions: process.versions, gpu: app.getGPUFeatureStatus() },
    limits: { syntheticOnly: true, backend: 'in-memory shell; no SQLite, disk, real IPC or sites', warmups: 3, formalSamples: 20,
      runtimeDeadlineMs: 60000, precision: 'analogous workload, not exact pre/post ratio; original synthetic source unavailable',
      cpu: 'CDP ThreadTime interval includes measurement commands; do not divide it by event latency',
      heap: 'GC snapshot of the full library workload; not isolated comparison heap or a leak claim',
      originalIndependentCompareTargets: { elements: 5500, heapMiB: 10, pairedCpuP95ReductionPercent: 25 } } };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report));
  console.log(JSON.stringify({ artifact: output, ok: report.ok, error, samples: samples.length, summary, targets, requests }));
  win.destroy(); app.exit(report.ok ? 0 : 1);
}).catch(error => { console.error(String(error.message).slice(0, 180)); app.exit(1); });
