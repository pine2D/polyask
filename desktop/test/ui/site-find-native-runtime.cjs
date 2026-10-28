const { app, BrowserWindow, ipcMain, session, Menu, nativeTheme } = require('electron');
const { join } = require('node:path'), fs = require('node:fs'), assert = require('node:assert/strict');
const output = process.argv[2], locale = process.argv[3];
process.on('uncaughtException', error => { console.error(String(error.stack || error)); app.exit(1); });
const step = name => fs.appendFileSync(join(output, 'trace-' + locale + '.jsonl'), JSON.stringify({ name, time:Date.now() }) + '\n');
step('start');
app.setPath('userData', join(output, 'profile-' + locale));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const services = require(join(output, 'services.cjs'));
let win, manager, palette;
const dispatched = [];
const dispatch = id => { dispatched.push(id); services.dispatchAppCommand(id, manager, win); };
app.on('web-contents-created', (_event, contents) =>
  services.bindApplicationCommandInput(contents, () => palette?.getState().mode ?? 'standard', dispatch));
app.whenReady().then(async () => {
  step('ready');
  const { SITES, SITE_FIND_HEIGHT } = services, keys = SITES.map(site => site.key);
  let blocked = 0;
  for (const s of [session.defaultSession, session.fromPartition('persist:polyask-sites')]) {
    s.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*'] }, (_details, callback) => { blocked++; callback({ cancel:true }); });
  }
  win = new BrowserWindow({ width:1600, height:1000, show:true,
    webPreferences:{ preload:join(output, 'preload.cjs'), sandbox:true, contextIsolation:true } });
  win.setMenuBarVisibility(false);
  manager = new services.ViewManager(win, () => {}, layout => win.webContents.send('polyask:layout', layout), () => {}, { selectedSites:keys });
  step('manager');
  const trusted = event => !win.isDestroyed() && event.sender === win.webContents && event.senderFrame?.parent === null;
  const menuTrace = { open: false, shown: 0, items: [] };
  const dispose = services.registerSiteFindIpc(ipcMain, manager.siteFind, trusted, win.webContents, state => {
    const build = Menu.buildFromTemplate;
    Menu.buildFromTemplate = template => {
      const menu = build.call(Menu, template);
      menuTrace.items = template;
      menu.on('menu-will-show', () => { menuTrace.open = true; menuTrace.shown++; });
      menu.on('menu-will-close', () => { menuTrace.open = false; });
      return menu;
    };
    try { return services.showSiteFindMenu(win, state, SITES, services.getCopy(locale)); }
    finally { Menu.buildFromTemplate = build; }
  });
  const pages = manager.getDiagnosticSites().map(site => ({ key:site.site,
    view:win.contentView.children.find(view => view.webContents?.id === site.webContentsId) }));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label) => {
    const end = Date.now() + 6000;
    while (!(await condition())) { if (Date.now() >= end) throw Error('Timeout: ' + label + ' :: ' + await win.webContents.executeJavaScript('document.body.innerText.slice(-900)')); await pause(20); }
  };
  await until(() => blocked >= keys.length && pages.every(page => !page.view.webContents.isLoadingMainFrame()), 'startup intercepted');
  step('startup intercepted');
  const needle = '跨站针尖', counts = [2,0,1,1,1,1,1,1,1];
  const html = count => '<meta charset="utf-8"><style>body{font:16px system-ui;background:#f6f7f9;color:#222}@media(prefers-color-scheme:dark){body{background:#202126;color:#eee}}</style><p>Local AI page</p>' +
    Array.from({ length:count }, () => '<div style="height:1400px"></div><p>' + needle + '</p>').join('');
  for (const [index, page] of pages.entries()) await page.view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html(counts[index])));
  step('local pages');
  const workspace = () => ({ selectedSites:keys, groups:[], tier:null });
  const sync = { state:'idle', connected:false, pending:0, errorCount:0, readOnly:false, oauthConfigured:false, secureTokenStorage:true };
  ipcMain.handle('polyask:bootstrap', () => ({ runtime:{ version:'native-find-check', distribution:'installed' }, sites:SITES,
    statuses:keys.map(site => ({ site, phase:'ready' })), layout:manager.getLayout(), workspace:workspace(),
    promptLibrary:{ templates:[], history:[] }, pendingSynthesis:null, sync }));
  ipcMain.handle('polyask:set-display', (_event, value) => {
    manager.setDisplayPreferences(value); win.webContents.send('polyask:display-preferences', value); return value;
  });
  ipcMain.handle('polyask:site-history-state', () => ({}));
  ipcMain.handle('polyask:menu-shortcuts', () => []);
  ipcMain.handle('polyask:question-panel', (_event, value) => manager.historyAccess.setPanelOpen(value));
  ipcMain.handle('polyask:question-list', () => ({ items:[], cursor:null }));
  ipcMain.handle('polyask:question-legacy', () => ({ items:[], cursor:null }));
  const preferences = () => ({ deviceId:'native', values:services.DEFAULT_PREFERENCE_VALUES,
    following:{ display:false, layout:false, siteZoom:false, proxy:false }, draftSync:false, initialized:[], versions:{} });
  ipcMain.handle('polyask:preferences', preferences); ipcMain.handle('polyask:preferences-seed', preferences);
  ipcMain.handle('polyask:draft-list', () => ({ epoch:0, deviceId:'native', drafts:[] }));
  ipcMain.handle('polyask:proxy-state', () => services.proxyStateFixture());
  for (const [channel, action] of [
    ['set-composer-expanded', value => manager.setComposerExpanded(value)], ['set-drawer-open', value => manager.setDrawerOpen(value)],
    ['set-page', value => manager.setPage(value)], ['set-layout', value => manager.setLayout(value.mode, value.focused)],
    ['set-surface', value => { manager.setSurface(value); if (value === 'confirmation') win.webContents.focus(); }]
  ]) ipcMain.on('polyask:' + channel, (event, value) => { if (trusted(event)) action(value); });
  const database = services.DesktopDatabase.open(join(output, 'palette-' + locale + '.sqlite'));
  database.meta.put('deviceId', 'native-palette');
  const repository = new services.CommandPaletteShortcutRepository(database.meta);
  let writeFailed = false;
  const startPalette = () => {
    palette = new services.CommandPaletteShortcutRuntime({
      repository: { read: () => repository.read(), write: mode => { if (writeFailed) throw Error('fixture-write-failed'); repository.write(mode); } },
      transaction: action => database.transaction(action),
      prepare: mode => services.prepareApplicationMenu([process.platform, services.getCopy(locale),
        { density:'compact', siteScale:0.9 }, () => {}, dispatch, 'PolyAsk', () => {}, mode]),
      publish: state => win.webContents.send('polyask:command-palette-shortcut-changed', state)
    });
    palette.restore();
    return services.registerCommandPaletteShortcutIpc({ ipcMain, trustedShell: trusted, runtime: palette,
      gate: new services.OperationGate(), isResetting: () => false });
  };
  let disposePalette = startPalette();
  const run = script => win.webContents.executeJavaScript(script);
  const paint = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const settled = () => until(() => manager.siteFind.state.open && manager.siteFind.state.query === needle &&
    manager.siteFind.state.sites.every(site => site.status !== 'pending'), 'find settled');
  const key = async (contents, keyCode, modifiers = []) => {
    for (const type of ['keyDown','keyUp']) contents.sendInputEvent({ type, keyCode, modifiers });
    await pause(100);
  };
  const click = async selector => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing click target');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({ type, button:'left', clickCount:1,
      x:Math.round(point.x * zoom), y:Math.round(point.y * zoom) });
    await paint();
  };
  const report = { locale, cases:[], layouts:[], blockedStartup:blocked };
  await win.loadFile(join(output, 'index.html'));
  step('shell loaded'); boundary();
  await until(() => run('!!document.querySelector(".app-shell")'), 'production shell');
  assert.equal(await run('document.documentElement.lang'), locale === 'en-US' ? 'en' : locale);
  for (const mode of ['standard', 'obsidian']) {
    await run(`window.polyask.setCommandPaletteShortcut(${JSON.stringify(mode)})`);
    for (const contents of [win.webContents, pages[0].view.webContents]) {
      dispatch('focus-prompt'); await until(() => run('!document.querySelector(".command-surface")'), 'return to sites');
      contents.focus(); const before = dispatched.filter(id => id === 'open-command-palette').length;
      await key(contents, 'P', mode === 'standard' ? ['control','shift'] : ['control']);
      await until(() => run('!!document.querySelector(".command-surface")'), 'palette from native key');
      assert.equal(dispatched.filter(id => id === 'open-command-palette').length - before, 1);
      dispatch('focus-prompt'); await until(() => run('!document.querySelector(".command-surface")'), 'close palette');
      contents.focus(); const after = dispatched.length;
      await contents.executeJavaScript('window.palettePassthrough=[];window.addEventListener("keydown",e=>{if(e.key.toLowerCase()==="p")window.palettePassthrough.push({prevented:e.defaultPrevented,shift:e.shiftKey})},{once:true})');
      await key(contents, 'P', mode === 'standard' ? ['control'] : ['control','shift']);
      assert.equal(await contents.executeJavaScript('window.palettePassthrough.length===1&&!window.palettePassthrough[0].prevented'), true, 'inactive palette key reaches the focused page');
      await key(contents, 'F1'); await key(contents, 'K', ['alt']);
      assert.equal(dispatched.length, after, 'inactive and removed keys never dispatch');
    }
    const items = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items ?? []);
    const item = items.find(item => item.label === services.getCopy(locale).commandPalette);
    assert.equal(item.accelerator, mode === 'standard' ? 'CmdOrCtrl+Shift+P' : 'CmdOrCtrl+P');
    const before = dispatched.length; item.click(); assert.equal(dispatched.length - before, 1);
    dispatch('focus-prompt'); await until(() => run('!document.querySelector(".command-surface")'), 'menu palette closed');
  }
  writeFailed = true;
  assert.equal((await run('window.polyask.setCommandPaletteShortcut("standard")')).error, 'command_shortcut_save_failed');
  assert.equal(repository.read(), 'obsidian'); assert.equal(palette.getState().mode, 'obsidian'); writeFailed = false;
  disposePalette(); palette.dispose(); disposePalette = startPalette();
  await win.loadFile(join(output, 'index.html'));
  await until(() => run('!!document.querySelector(".app-shell")'), 'shell after runtime restart');
  assert.equal((await run('window.polyask.commandPaletteShortcutState()')).mode, 'obsidian');
  assert.equal(palette.refreshAfterReset().mode, 'obsidian', 'failed wipe retains actual saved mode');
  database.resetLocalData(); assert.equal(palette.refreshAfterReset().mode, 'standard');
  assert.equal(database.meta.get('deviceId'), 'native-palette');
  report.cases.push('palette: both modes in shell/site, one dispatch, removed/inactive keys zero, menu/save rollback/restart/reset');
  const originalY = manager.getLayout().placements[0].bounds.y;
  pages[0].view.webContents.focus(); await key(pages[0].view.webContents, 'F', ['control']);
  await until(() => run('document.activeElement?.name==="site-find-query"'), 'native site Ctrl+F opens shell search');
  assert.equal(manager.getLayout().placements[0].bounds.y - originalY, SITE_FIND_HEIGHT);
  await win.webContents.insertText(needle); await settled(); await paint();
  step('first search');
  assert.deepEqual(manager.siteFind.state.sites.map(site => site.matches), counts, 'all nine native pages counted');
  assert.equal(manager.siteFind.state.sites.every(site => site.status === 'ready'), true);
  report.cases.push('native site shortcut; nine-page counts including background');
  await require('./site-find-native-menu.cjs')({ win, run, until, paint, click, manager, menuTrace, keys, output, locale });
  report.cases.push('native popup pointer and keyboard site selection, Escape-only cancellation and query focus restoration');
  manager.siteFind.find({ query: needle, scope: 'all' }); await settled();
  await key(win.webContents, 'Enter'); await settled();
  assert.equal(manager.siteFind.state.sites[0].active, 2);
  await until(() => pages[0].view.webContents.executeJavaScript('scrollY>1000'), 'native scroll to offscreen second match');
  await pages[0].view.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  fs.writeFileSync(join(output, locale + '-native-match.png'), (await pages[0].view.webContents.capturePage()).toPNG());
  await click('[name=site-find-next]'); await settled();
  assert.equal(manager.siteFind.state.activeSite, keys[2], 'zero-match page skipped');
  assert.equal(await run('document.activeElement?.name'), 'site-find-query', 'next button returns query focus');
  await key(win.webContents, 'Enter'); await settled();
  assert.equal(manager.siteFind.state.activeSite, keys[3]); assert.equal(manager.getLayout().page, 1);
  await click('[data-find-site=' + keys[8] + ']'); await settled();
  assert.equal(manager.getLayout().page, 2); assert.equal(manager.siteFind.state.activeSite, keys[8]);
  await key(win.webContents, 'Enter'); await settled(); assert.equal(manager.siteFind.state.activeSite, keys[0]);
  await key(win.webContents, 'Enter', ['shift']); await settled(); assert.equal(manager.siteFind.state.activeSite, keys[8]);
  assert.equal(await run('document.activeElement?.name'), 'site-find-query');
  report.cases.push('offscreen scroll; cross-page forward/backward wrapping; input focus retained');
  step('cross-page');
  await key(win.webContents, 'F', ['control']);
  assert.deepEqual(await run('(()=>{const e=document.querySelector("[name=site-find-query]");return[e.selectionStart,e.selectionEnd]})()'), [0, needle.length]);
  await run('window.polyask.findSites({query:' + JSON.stringify(needle) + ',scope:"current"})'); await settled();
  assert.equal(manager.siteFind.state.sites.length, 1); assert.equal(manager.siteFind.state.sites[0].site, keys[8]);
  manager.setLayout('overview', keys[0], false); await settled();
  assert.equal(manager.siteFind.state.sites[0].site, keys[0]);
  await run('window.polyask.findSites({query:' + JSON.stringify(needle) + ',scope:"all"})'); await settled();
  const last = pages[8].view.webContents;
  await last.executeJavaScript('document.body.insertAdjacentHTML("beforeend","<p>' + needle + '</p>")');
  await run('window.polyask.findSites({query:' + JSON.stringify(needle) + ',scope:"all"})'); await settled();
  assert.equal(manager.siteFind.state.sites[8].matches, 2);
  await last.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html(3))); await settled();
  assert.equal(manager.siteFind.state.sites[8].matches, 3);
  manager.setLayout('overview', keys[0], false);
  manager.siteFind.find({ query:needle, scope:'all' }); await settled();
  await run('Promise.all([window.polyask.moveSiteFind(1),window.polyask.moveSiteFind(1),window.polyask.moveSiteFind(1)])');
  await until(() => manager.siteFind.state.activeSite === keys[3] && manager.siteFind.state.sites.every(site => site.status !== 'pending'), 'rapid next presses');
  await pages[0].view.webContents.executeJavaScript('document.body.insertAdjacentHTML("beforeend",\'<a id="blocked-link" href="http://example.invalid/blocked">Blocked link</a>\');document.querySelector("#blocked-link").click()');
  await settled();
  assert.equal(manager.siteFind.state.sites[0].matches, 2); assert.equal(manager.siteFind.state.sites[0].status, 'ready');
  report.cases.push('rapid next presses retained; blocked navigation keeps retained page searchable');
  report.cases.push('current scope follows focus; DOM refresh and navigation recount');
  step('recount');
  manager.setSurface('confirmation'); assert.equal(manager.siteFind.state.open, false);
  dispatch('find-page'); assert.equal(manager.siteFind.open().open, false);
  manager.setSurface('sites'); dispatch('find-page'); await settled();
  pages[0].view.webContents.focus(); await key(pages[0].view.webContents, 'Escape');
  assert.equal(manager.siteFind.state.open, false);
  await until(() => run('!document.querySelector(".site-find")'), 'Escape removes search bar');
  assert.equal(manager.getLayout().placements[0].bounds.y, originalY);
  assert.equal(pages.every(page => page.view.webContents.listenerCount('found-in-page') === 0), true);
  dispatch('open-question-history'); await until(() => manager.historyAccess.panelOpen, 'history panel opened');
  dispatch('find-page'); await settled(); assert.equal(manager.historyAccess.panelOpen, false);
  report.cases.push('confirmation blocks find; native Escape cleans highlights/listeners and geometry; history-to-find transition');
  dispatch('open-sites');
  await until(() => !manager.siteFind.state.open, 'opening sidebar closes find');
  await until(() => run('!document.querySelector(".site-find")'), 'sidebar find UI released');
  assert.equal(await run('!!document.querySelector(".site-find")'), false);
  await run(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'find-fixture.png',{type:'image/png'}));document.querySelector('[name=prompt]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}))})()`);
  await until(() => run('document.querySelector(".image-trigger")?.dataset.imageCount==="1"'), 'fixture image loaded');
  dispatch('find-page'); await settled();
  await click('.image-trigger');
  await until(() => !manager.siteFind.state.open, 'opening image tray closes find');
  await until(() => run('document.querySelector(".image-tray")?.dataset.state==="open"'), 'image tray open');
  await click('.image-preview button');
  dispatch('find-page'); await settled();
  report.cases.push('find-to-sidebar and find-to-image-tray remain mutually exclusive');
  step('lifecycle');
  for (const theme of ['light','dark']) for (const density of ['compact','comfortable']) {
    nativeTheme.themeSource = theme;
    await run('window.polyask.setDisplayPreferences(' + JSON.stringify({ density, siteScale:0.9 }) + ')');
    for (const cssWidth of [336,480,720,960,1440]) for (const zoom of [1,2]) for (const expanded of [false,true]) {
      const width = cssWidth * zoom;
      win.setContentSize(width, 1000); win.webContents.setZoomFactor(zoom); manager.relayout();
      await run(`(()=>{const e=document.querySelector('[data-composer-toggle]');if(e.getAttribute('aria-expanded')!==${JSON.stringify(String(expanded))})e.click()})()`);
      await until(() => run('document.documentElement.dataset.density===' + JSON.stringify(density)), 'density applied');
      const stacked = width / zoom < 960;
      const heights = density === 'compact' ? stacked ? [120,200] : [52,120] : stacked ? [144,240] : [64,144];
      const expectedTop = heights[Number(expanded)];
      await until(() => run('document.querySelector(".app-shell").classList.contains("is-composer-expanded")===' + expanded), 'composer reservation settled');
      await until(() => manager.getLayout().placements[0].bounds.y === expectedTop + SITE_FIND_HEIGHT, 'native reservation settled');
      await paint();
      const geometry = await run(`(()=>{const bar=document.querySelector('.site-find'),b=bar.getBoundingClientRect();
        return{width:innerWidth,left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height,
        overflow:[...bar.querySelectorAll('input,select,button,.site-find-info')].some(e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;return r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1})}})()`);
      assert.equal(geometry.width, cssWidth); assert.equal(geometry.height, 48); assert.equal(SITE_FIND_HEIGHT, 48); assert.equal(geometry.overflow, false);
      assert.equal(geometry.top, expectedTop);
      assert.equal(geometry.right <= geometry.width + 1, true);
      assert.equal(manager.getLayout().placements.every(placement => placement.bounds.y >= geometry.bottom - 1), true, 'native views must not cover search');
      assert.equal(pages.every(page => page.view.getBounds().height > 0), true);
      report.layouts.push({ theme, density, width, zoom, expanded, ...geometry });
      if (density === 'comfortable' && zoom === 1 && expanded === false && width !== 960) {
        await paint(); fs.writeFileSync(join(output, `${locale}-${theme}-${width}.png`), (await win.capturePage()).toPNG());
      }
    }
  }
  await require('./site-find-native-states.cjs')({ win, run, until, paint, manager, keys, needle, SITE_FIND_HEIGHT, report, output, locale });
  nativeTheme.themeSource = 'light';
  await require('./site-find-native-markers.cjs')({ win, run, until, paint, manager, pages, keys, output, locale, report });
  manager.siteFind.close(false);
  step('layouts'); boundary();
  await win.loadFile(join(output, 'index.html'));
  await until(() => run('!!document.querySelector(".app-shell")'), 'shell reload');
  assert.equal(manager.siteFind.state.open, false);
  fs.writeFileSync(join(output, 'report-' + locale + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ locale, cases:report.cases, layouts:report.layouts.length, output }));
  console.log('SITE_FIND_NATIVE_COMPLETE');
  disposePalette(); palette.dispose(); database.close(); dispose(); win.destroy(); app.exit(0);
}).catch(error => { console.error(String(error.stack || error)); app.exit(1); });
