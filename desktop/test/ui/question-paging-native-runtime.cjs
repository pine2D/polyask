const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), { join } = require('node:path');
const output = process.argv[2], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setPath('userData', join(output, 'profile')); app.setPath('sessionData', join(output, 'profile', 'session'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const report = { cases:[], network:0 };
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] }, (_d, cb) => { report.network++; cb({ cancel:true }); });
  const win = new BrowserWindow({ width:1200, height:900, show:true, webPreferences:{ sandbox:true, contextIsolation:true } });
  win.setMenuBarVisibility(false);
  const run = code => win.webContents.executeJavaScript(code);
  const until = async (code, label) => {
    const end = Date.now() + 5000;
    while (!(await run(code))) { if (Date.now() > end) throw Error('Timeout: ' + label); await pause(30); }
  };
  const key = async keyCode => {
    for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode });
    await pause(350);
  };
  const click = async selector => {
    const point = await run('(()=>{const r=document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, button:'left', clickCount:1, x:Math.round(point.x * zoom), y:Math.round(point.y * zoom) });
    await pause(200);
  };
  for (const zoom of [1, 1.5, 2]) {
    await win.loadFile(join(output, 'index.html')); win.webContents.setZoomFactor(zoom); win.focus(); win.webContents.focus();
    await until('document.querySelectorAll(".question-main").length===40', 'history loaded'); await pause(250); boundary();
    await run('window.pagingKeys=[];window.addEventListener("keydown",e=>{if(e.key.startsWith("Page"))setTimeout(()=>window.pagingKeys.push({trusted:e.isTrusted,key:e.key,prevented:e.defaultPrevented}),0)},true)');
    assert.equal(await run('document.activeElement?.type'), 'search');
    await key('PageDown');
    const listDown = await run('document.querySelector(".question-scroll").scrollTop');
    assert.equal(listDown > 100, true, 'search PgDn scrolls list');
    assert.equal(await run('document.activeElement.classList.contains("question-scroll")'), true);
    await key('PageUp'); assert.equal(await run('document.querySelector(".question-scroll").scrollTop') < listDown, true);
    await click('.question-main');
    await until('!!document.querySelector(".markdown-preview")', 'saved answer loaded');
    assert.equal(await run('document.activeElement.classList.contains("question-reader")'), true);
    await key('PageDown');
    const readerDown = await run('document.querySelector(".question-reader").scrollTop');
    assert.equal(readerDown > 100, true, 'opening answer enables native PgDn immediately');
    await key('PageUp'); assert.equal(await run('document.querySelector(".question-reader").scrollTop') < readerDown, true);
    await key('Tab');
    assert.equal(await run('document.activeElement.tagName'), 'BUTTON', 'reader Tab reaches its first control');
    await key('PageDown');
    assert.equal(await run('document.querySelector(".question-reader").scrollTop') > 0, true, 'native PgDn also works from a reader control');
    await click('.question-header button');
    await until('!!document.querySelector(".question-scroll")', 'back to list');
    assert.equal(await run('document.activeElement?.type'), 'search', 'return restores search focus');
    const trace = await run('window.pagingKeys');
    assert.equal(trace.length, 5); assert.equal(trace.every(event => event.trusted), true);
    assert.equal(trace[0].prevented, true, 'search intercepts exactly the initial paging event');
    assert.equal(trace.slice(1).every(event => !event.prevented), true, 'focused regions use native paging');
    fs.writeFileSync(join(output, 'paging-' + zoom + '.png'), (await win.capturePage()).toPNG());
    report.cases.push({ zoom, listDown, readerDown, trace }); boundary();
  }
  fs.writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('HISTORY_PAGING_NATIVE_COMPLETE'); win.destroy(); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
