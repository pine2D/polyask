const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { computeWorkspaceLayout, applyWorkspaceLayout } = require(join(process.argv[2], 'layout.cjs'));
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
let win;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  win = new BrowserWindow({ width: 1200, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.setMenuBarVisibility(false);
  const run = source => win.webContents.executeJavaScript(source).catch(error => { throw Error(`Progress fixture evaluation: ${source.slice(0, 220)} (${String(error).slice(0, 100)})`); });
  const paint = () => run('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(String(message).slice(0, 300)); });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const wait = async source => { for (let i = 0; i < 150; i++) { if (await run(source)) return; await paint(); } throw Error(`Timeout: ${source}`); };
  const click = async selector => {
    win.focus(); await wait('document.hasFocus()');
    const point = await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest',inline:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const z = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(point.x*z), y: Math.round(point.y*z) }); await paint();
  };
  const views = new Map();
  for (const site of ['claude', 'kimi']) {
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.contentView.addChildView(view); await view.webContents.loadURL('data:text/html,<p>Local native viewport</p>'); views.set(site, view);
  }
  const reports = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const density of ['compact', 'comfortable']) {
    win.webContents.setZoomFactor(1); win.setContentSize(1200, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, density } }); await wait('document.querySelectorAll("[role=tab]").length===3');
    for (const expanded of [false, true]) for (const zoom of [1, 1.5]) {
      win.webContents.setZoomFactor(zoom); await run(`window.progressFixture.expanded(${expanded})`); await paint();
      const size = await run('({width:innerWidth,height:innerHeight,bottom:document.querySelector(".workspace-progress").getBoundingClientRect().bottom})');
      const layout = computeWorkspaceLayout({ ...size, density, composerExpanded: expanded, drawerOpen: false,
        requestedMode: 'overview', focused: 'claude', overviewOrder: ['claude','kimi'], focusOrder: ['claude','kimi'] });
      check(Math.abs(layout.placements[0].bounds.y-size.bottom)<1, 'CSS strip and main native origin agree exactly once');
      applyWorkspaceLayout({ siteZoom: { apply() {} }, views, placements: layout.placements, metrics: layout.metrics,
        zoom, display: { density, siteScale: 1 }, mode: layout.mode, focused: 'claude' });
      const dimensions = await Promise.all([...views.values()].map(view => view.webContents.executeJavaScript('({w:innerWidth,h:innerHeight})')));
      check(dimensions.every(d=>d.w>0&&d.h>0), 'real native renderers retain positive viewports');
    }
    win.webContents.setZoomFactor(1); await run('window.progressFixture.expanded(false); window.progressFixture.evidence("waiting")'); await paint();
    check(await run('document.querySelector("[data-progress=ended]").textContent.includes("1/3")&&document.querySelector("[data-progress=complete]").textContent.includes("0/3")'), 'positive generation is separate from stored copies');
    check(await run('document.querySelectorAll(".page-tab-badge.failed").length===0'), 'old exceptions excluded');
    await run('document.querySelector("[role=tab]").focus()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' }); await paint();
    check(await run('document.activeElement.dataset.page==="1"&&document.getElementById("site-page-tab-0").getAttribute("aria-selected")==="true"'), 'manual native tab activation');
    for (const view of views.values()) view.setVisible(false);
    await run('window.progressFixture.evidence("partial")'); await paint(); await click('[name=read-run-copies]');
    await wait('document.querySelector(".markdown-preview")?.textContent.includes("Saved Claude body")');
    const state = await run('window.progressFixture.state()'); check(state.reads===1&&state.live===0, 'reading does not collect or submit');
    writeFileSync(join(output, `${locale}-${density}.png`), (await win.webContents.capturePage()).toPNG());
    reports.push({ locale, density, nativeKeys: true, exactRead: true, layoutZooms: 4, liveActions: state.live });
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(reports));
  for (const view of views.values()) view.webContents.close(); win.destroy(); app.exit(0);
}).catch(async error => { if (win && !win.isDestroyed()) writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error(String(error.message).slice(0,600)); app.exit(1); });
