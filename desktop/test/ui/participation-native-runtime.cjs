const { app, BrowserWindow, ipcMain, session } = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output = process.argv[2], phase = process.argv[3];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('lang', 'zh-CN');
app.whenReady().then(async () => {
  const { DesktopDatabase, WorkspaceService, SyncRepository, registerWorkspaceSelectionIpc, SITES } = require(join(output, 'services.cjs'));
  const database = DesktopDatabase.open(join(output, 'profile', 'polyask.sqlite'));
  database.meta.put('deviceId', 'local');
  const workspace = new WorkspaceService(database.state, database.meta, () => {});
  if (phase === 'write') { workspace.setSelection(['claude', 'kimi']); workspace.setParticipation(['claude', 'kimi']); }
  const repository = new SyncRepository(database);
  let blocked = 0, publications = 0;
  for (const s of [session.defaultSession, session.fromPartition('persist:polyask-sites')]) {
    s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => { blocked++; callback({ cancel: true }); });
  }
  const win = new BrowserWindow({ show: true, width: 1400, height: 900,
    webPreferences: { preload: join(output, 'preload.cjs'), sandbox: true, contextIsolation: true } });
  win.webContents.on('console-message', event => { if (event.level === 'error') console.log('Renderer:', event.message); });
  win.setMenuBarVisibility(false);
  const { ViewManager } = require(join(output, 'manager.cjs'));
  const manager = new ViewManager(win, () => {}, layout => win.webContents.send('polyask:layout', layout), () => {},
    { selectedSites: workspace.getState().selectedSites });
  const views = win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    const end = Date.now() + 5000;
    while (!(await run(source))) {
      if (Date.now() > end) {
        fs.writeFileSync(join(output, `${phase}-failure.png`), (await win.webContents.capturePage()).toPNG());
        console.log(JSON.stringify({ workspace: workspace.getState(), publications, ui: await run(`({
          count: document.querySelector('.send-count')?.textContent, clicks: window.nativeClicks,
          checked: document.querySelector('.tile-header input[value=claude]')?.checked,
          disabled: document.querySelector('.tile-header input[value=claude]')?.disabled,
          announcement: document.querySelector('[aria-live]')?.textContent })`) }));
        throw Error('Timeout: ' + source);
      }
      await pause(20);
    }
  };
  const loadEnd = Date.now() + 5000;
  while (blocked < 2 || views.some(view => view.webContents.isLoadingMainFrame())) {
    if (Date.now() > loadEnd) throw Error('Blocked site loads did not settle'); await pause(20);
  }
  for (const view of views) await view.webContents.loadURL('data:text/html,<input placeholder="local page">');
  const sync = { state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true };
  ipcMain.handle('polyask:bootstrap', () => ({ runtime: { version: 'native-check', distribution: 'installed' }, sites: SITES,
    statuses: [], layout: manager.getLayout(), display: manager.getDisplayPreferences(), workspace: workspace.getState(),
    promptLibrary: { templates: [], history: [] }, pendingSynthesis: null, questionRunProgress: null, sync }));
  ipcMain.handle('polyask:set-display', (_event, value) => { manager.setDisplayPreferences(value); return value; });
  ipcMain.handle('polyask:site-history-state', () => ({}));
  ipcMain.handle('polyask:menu-shortcuts', () => []);
  const publish = () => {
    const state = workspace.getState(); publications++; manager.setSelection(state.selectedSites);
    win.webContents.send('polyask:workspace-state', state); return state;
  };
  registerWorkspaceSelectionIpc(ipcMain, workspace, event => event.sender === win.webContents && event.senderFrame?.parent === null, publish);
  for (const [channel, action] of [
    ['set-composer-expanded', value => manager.setComposerExpanded(value)],
    ['set-drawer-open', value => manager.setDrawerOpen(value)], ['set-surface', value => manager.setSurface(value)]
  ]) ipcMain.on('polyask:' + channel, (event, value) => { if (event.sender === win.webContents) action(value); });
  const count = value => wait(`document.querySelector('.send-count')?.textContent === '${value}'`);
  await win.loadFile(join(output, 'index.html')); win.focus(); win.webContents.focus();
  await wait('document.querySelector(".tile-header input[value=claude]") !== null');
  const check = (name, expected) => {
    assert.deepEqual(workspace.getState().participatingSites, expected, name);
    assert.deepEqual(workspace.getState().selectedSites, ['claude', 'kimi'], 'pages remain open');
    assert.equal(win.contentView.children.filter(view => view.webContents !== win.webContents).length, 2, 'native pages retained');
  };
  if (phase === 'write') {
    await count(2);
    await run(`window.nativeClicks=[];for(const type of ['click','change'])document.addEventListener(type, e => nativeClicks.push({type,trusted:e.isTrusted,
      tag:e.target.tagName,cls:e.target.className,value:e.target.value}),true)`);
    const point = await run(`(() => { const r = document.querySelector('.tile-header input[value=claude]').closest('label').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const zoom = win.webContents.getZoomFactor();
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
      x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    await count(1); check('native uncheck saved', ['kimi']);
    assert.equal(await run(`nativeClicks.some(event => event.type === 'change' && event.trusted && event.value === 'claude')`), true, 'trusted native checkbox change');
    assert.equal(database.state.get('workspace').participation.sites.join(','), 'kimi');
  } else {
    await count(1); check('process restart restored', ['kimi']);
    const remoteDatabase = DesktopDatabase.open(':memory:'); remoteDatabase.meta.put('deviceId', 'remote');
    const remoteWorkspace = new WorkspaceService(remoteDatabase.state, remoteDatabase.meta, () => {});
    const remoteRepository = new SyncRepository(remoteDatabase);
    remoteRepository.applyStateFragments({ local: repository.localStateFragment() });
    for (const expected of [[], ['kimi']]) {
      remoteWorkspace.setParticipation(expected);
      repository.applyStateFragments({ remote: remoteRepository.localStateFragment() }); publish();
      await count(expected.length); check('remote push applied', expected);
      if (!expected.length) assert.equal(await run('document.querySelector(".send").disabled'), true, 'empty selection blocks sending');
    }
    remoteDatabase.close();
  }
  fs.writeFileSync(join(output, `${phase}.png`), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(join(output, `${phase}.json`), JSON.stringify({ phase, participation: workspace.getState().participatingSites,
    opened: workspace.getState().selectedSites, publications, blocked, nativePages: 2 }, null, 2));
  console.log(JSON.stringify({ phase, participation: workspace.getState().participatingSites, publications, nativePages: 2 }));
  database.close(); win.destroy(); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
