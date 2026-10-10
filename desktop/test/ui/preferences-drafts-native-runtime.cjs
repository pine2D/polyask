const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const { join } = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const output = process.argv[2], locale = process.argv[3], phase = process.argv[4];
const profile = join(output, locale, 'profile');
app.setPath('userData', profile);
app.commandLine.appendSwitch('lang', locale);
app.whenReady().then(async () => {
  const services = require(join(output, 'services.cjs'));
  const { DesktopDatabase, WorkspaceService, PreferencesRepository, DraftRepository, PreferenceRuntime,
    registerPreferencesDraftsIpc, registerWorkspaceSelectionIpc, createLocalDataServices, createArchiveRecord,
    registerDecisionIpc, registerTaskFolderIpc, NativeCloud, nativeEngine, SITES, getCopy } = services;
  const database = DesktopDatabase.open(join(profile, 'polyask.sqlite'));
  database.meta.put('deviceId', 'native-local');
  const remote = DesktopDatabase.open(join(profile, 'remote.sqlite'));
  remote.meta.put('deviceId', 'native-remote');
  const local = createLocalDataServices(database);
  const coldSharedDisplay = phase === 'read' ? Object.fromEntries(['density', 'siteScale']
    .map(key => [key, database.state.get('preference:' + key)])) : null;
  if (phase === 'write') database.archives.put(createArchiveRecord({ text: 'Synthetic isolated question',
    task: `Native saved answers ${locale}`, results: [
      { host: 'claude.ai', label: 'Claude', text: 'A locally generated answer for draft testing.' },
      { host: 'www.kimi.com', label: 'Kimi', text: 'Another locally generated answer for draft testing.' }
    ] }, { id: 'native-archive', now: 100, deviceId: 'native-local' }));
  const workspace = new WorkspaceService(database.state, database.meta, () => {});
  if (phase === 'write') { workspace.setSelection(['claude', 'chatgpt', 'gemini', 'deepseek', 'kimi']); workspace.setParticipation(['claude', 'kimi']); }
  let blocked = 0, forbidden = 0;
  for (const s of [session.defaultSession, session.fromPartition('persist:polyask-sites')]) {
    s.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => { blocked++; callback({ cancel: true }); });
  }
  const win = new BrowserWindow({ show: true, width: 1400, height: 900,
    webPreferences: { preload: join(output, 'preload.cjs'), sandbox: true, contextIsolation: true } });
  win.setMenuBarVisibility(false);
  win.webContents.on('console-message', event => { if (event.level === 'error') console.log('Renderer:', event.message); });
  const { ViewManager } = require(join(output, 'manager.cjs'));
  const uiPath = join(profile, 'ui.json');
  let preferences, surface = 'sites';
  const manager = new ViewManager(win, () => {}, layout => win.webContents.send('polyask:layout', layout), () => {}, {
    selectedSites: workspace.getState().selectedSites,
    initialUiState: fs.existsSync(uiPath) ? JSON.parse(fs.readFileSync(uiPath, 'utf8')) : undefined,
    onUiStateChange: state => { fs.writeFileSync(uiPath, JSON.stringify(state)); preferences?.captureUi(state); }
  });
  const views = win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents);
  const nativeCommands = [];
  Menu.setApplicationMenu(Menu.buildFromTemplate(services.applicationMenu(process.platform, getCopy(locale),
    manager.getDisplayPreferences(), () => {}, id => {
      nativeCommands.push(id); services.dispatchAppCommand(id, manager, win);
    }, 'PolyAsk native fixture')));
  const tools = require('./preferences-drafts-native-tools.cjs')(win, output, `${locale}-${phase}`);
  const { run, wait, pause, click, clickText, clickElement, type, key } = tools;
  const loadEnd = Date.now() + 8000;
  while (blocked < views.length || views.some(view => view.webContents.isLoadingMainFrame())) {
    if (Date.now() >= loadEnd) throw Error('Blocked site loads did not settle'); await pause(25);
  }
  for (const view of views) {
    await view.webContents.loadURL('data:text/html,<input placeholder="isolated local page">');
    await view.webContents.loadURL('data:text/html,<input placeholder="isolated local page with back history">');
  }
  const notifyDrafts = () => win.webContents.send('polyask:drafts-changed');
  const repository = new PreferencesRepository(database.state, database.meta);
  const drafts = new DraftRepository(database.state, database.meta);
  preferences = new PreferenceRuntime(repository, drafts, manager,
    value => win.webContents.send('polyask:preferences-changed', value), value => {
      manager.setDisplayPreferences(value); win.webContents.send('polyask:display-preferences', value);
    }, () => {});
  const drive = new NativeCloud(join(profile, 'synthetic-cloud.json'));
  const engine = nativeEngine(database, drive, () => { preferences.refresh(); notifyDrafts(); });
  const remoteEngine = nativeEngine(remote, drive);
  const remotePreferences = new PreferencesRepository(remote.state, remote.meta);
  const remoteDrafts = new DraftRepository(remote.state, remote.meta);
  const trusted = event => event.sender === win.webContents && event.senderFrame?.parent === null &&
    event.senderFrame.url.startsWith('file://');
  registerPreferencesDraftsIpc({ runtime: preferences, trusted, publishDrafts: notifyDrafts });
  registerDecisionIpc({ decisions: local.decisions, trusted });
  registerTaskFolderIpc({ folders: local.folders, trusted });
  const handle = (channel, action) => ipcMain.handle('polyask:' + channel, (event, value) => {
    if (!trusted(event)) throw Error('untrusted_sender'); return action(value);
  });
  handle('bootstrap', () => ({ runtime: { version: 'native-fixture', distribution: 'installed' }, sites: SITES,
    statuses: [], layout: manager.getLayout(), display: manager.getDisplayPreferences(), workspace: workspace.getState(),
    promptLibrary: { templates: [], history: [] }, pendingSynthesis: null, questionRunProgress: null, sync: engine.status() }));
  handle('set-display', value => preferences.setDisplay(value));
  handle('menu-shortcuts', () => []);
  handle('site-history-state', () => ({}));
  handle('sync-diagnostics', () => engine.diagnostics({ version: 'native-fixture', distribution: 'installed' }));
  handle('sync-now', () => engine.syncNow());
  handle('archive-search', value => local.archives.search(value ?? {}));
  handle('archive-tags', () => local.archives.tags());
  handle('archive-get', id => local.archives.get(id));
  handle('show-command-menu', () => 'open-settings');
  for (const channel of ['broadcast', 'synthesis-send', 'open-external', 'new-session', 'collect', 'archive-capture']) handle(channel, () => {
    forbidden++; throw Error('native_fixture_disallows_site_send');
  });
  registerWorkspaceSelectionIpc(ipcMain, workspace, trusted, () => workspace.getState());
  for (const [channel, action] of [
    ['set-composer-expanded', value => manager.setComposerExpanded(value)],
    ['set-drawer-open', value => manager.setDrawerOpen(value)],
    ['set-completion-notifications', value => preferences.set('completionNotifications', value)],
    ['set-layout', value => { manager.setLayout(value.mode, value.focused); preferences.set('layoutMode', value.mode); }],
    ['set-surface', value => { surface = value; manager.setSurface(value); if (value === 'confirmation') win.webContents.focus(); }]
  ]) ipcMain.on('polyask:' + channel, (event, value) => { if (trusted(event)) action(value); });
  await win.loadFile(join(output, 'index.html')); win.focus(); win.webContents.focus();
  await wait('!!document.querySelector("textarea[name=prompt]")');
  await require('./command-bar-layout.cjs')({ win, run, output, label: `${locale}-${phase}` });
  await run(`window.nativeInputs=[]; for(const type of ['click','change','input','paste'])document.addEventListener(type,
    event=>nativeInputs.push({type,trusted:event.isTrusted,name:event.target.name,tag:event.target.tagName}),true)`);
  const copy = getCopy(locale);
  const openSettings = async () => { await click('.more-trigger'); await wait('!!document.querySelector(".settings-workspace")'); };
  const closeSettings = async () => { await click('.settings-toolbar .panel-close'); await wait('!!document.querySelector("textarea[name=prompt]")'); };
  if (phase === 'write') {
    await openSettings();
    for (const group of ['display', 'layout', 'siteZoom']) for (const value of ['shared', 'local', 'shared']) {
      await click(`input[name="settings-follow-${group}"][value="${value}"]`);
      await wait(`document.querySelector('input[name="settings-follow-${group}"][value="${value}"]').checked &&
        !document.querySelector('input[name="settings-follow-${group}"][value="${value}"]').disabled`);
      assert.equal(preferences.snapshot().following[group], value === 'shared');
    }
    await click('input[name="completion-notifications"]');
    await wait('document.querySelector("input[name=completion-notifications]").checked');
    assert.equal(preferences.snapshot().values.completionNotifications, true);
    await click('input[name="draft-sync"]');
    await wait('document.querySelector("input[name=draft-sync]").checked && !document.querySelector("input[name=draft-sync]").disabled');
    await closeSettings();
    await type('textarea[name="prompt"]', `Local active edit ${locale}`);
    const deadline = Date.now() + 8000;
    while (!drafts.list('prompt').some(value => value.content?.text === `Local active edit ${locale}`)) {
      if (Date.now() >= deadline) throw Error('Native prompt did not persist'); await pause(30);
    }
    assert.equal((await engine.syncNow()).state, 'idle');
    assert.equal((await remoteEngine.syncNow()).state, 'idle');
    remoteDrafts.setSyncEnabled(true);
    const own = drafts.list('prompt').find(value => value.deviceId === 'native-local');
    remoteDrafts.save({ kind: 'prompt', context: own.context, title: `Remote prompt ${locale}`, content: { text: `Remote saved prompt ${locale}` } });
    remotePreferences.setFollowing('display', true); remotePreferences.set('density', 'comfortable');
    remotePreferences.set('completionNotifications', false);
    assert.equal((await remoteEngine.syncNow()).state, 'idle');
    assert.equal((await engine.syncNow()).state, 'idle');
    assert.equal(await run('document.querySelector("textarea[name=prompt]").value'), `Local active edit ${locale}`, 'remote push preserves active input');
    assert.equal(preferences.snapshot().values.display.density, 'comfortable');
    const attachments = await require('./preferences-drafts-native-attachments.cjs')({ tools, win, profile });
    await click('[data-draft-open]');
    await wait('!!document.querySelector(".draft-copy-list")');
    assert.equal(surface, 'confirmation', 'prompt recovery covers native views');
    assert.equal(views.every(view => !view.getVisible() && view.getBounds().width > 0), true);
    const confirmation = await require('./preferences-drafts-native-confirmation.cjs')({ tools, win, manager,
      views, commands: nativeCommands, surface: () => surface });
    fs.writeFileSync(join(output, `${locale}-confirmation.json`), JSON.stringify(confirmation, null, 2));
    await clickElement(`[...document.querySelectorAll('.draft-copy-list li')].find(e=>e.querySelector('small').textContent===${JSON.stringify(copy.draftRemote)}).querySelector('button')`);
    await clickText('.draft-actions button', copy.draftRestore);
    await wait('!!document.querySelector(".draft-confirm")');
    assert.equal(await run(`document.querySelector('.draft-confirm').textContent.includes(${JSON.stringify(copy.questionClearImages)})`), true);
    await click('.draft-confirm .confirm-actions button:not(.primary)');
    assert.equal(await run('document.querySelector("textarea[name=prompt]").value'), `Local active edit ${locale}`, 'cancel replacement retains active form');
    await attachments.afterCancel();
    await clickText('.draft-actions button', copy.draftRestore);
    await click('.draft-confirm .primary');
    await wait(`document.querySelector('textarea[name=prompt]').value===${JSON.stringify(`Remote saved prompt ${locale}`)}`);
    await attachments.afterRestore();
    assert.equal(surface, 'sites');
    assert.equal(views.every(view => view.getVisible()), true);
    const persisted = Date.now() + 8000;
    while (!drafts.list('prompt').some(value => value.deviceId === 'native-local' && value.content?.text === `Remote saved prompt ${locale}`)) {
      if (Date.now() >= persisted) throw Error('Restored prompt did not persist'); await pause(30);
    }
  } else {
    await wait('document.documentElement.dataset.density==="comfortable"');
    assert.deepEqual(manager.getDisplayPreferences(), { density: 'comfortable', siteScale: 0.9 });
    for (const key of ['density', 'siteScale']) assert.deepEqual(database.state.get('preference:' + key), coldSharedDisplay[key],
      'cold startup must not write the older display cache into shared preferences');
    await wait(`document.querySelector('textarea[name=prompt]').value===${JSON.stringify(`Remote saved prompt ${locale}`)}`);
    assert.equal(preferences.snapshot().values.display.density, 'comfortable');
    assert.equal(preferences.snapshot().values.completionNotifications, false);
    assert.equal(preferences.snapshot().draftSync, true);
    for (const group of ['display', 'layout', 'siteZoom']) assert.equal(preferences.snapshot().following[group], true);
    assert.equal(drafts.list('prompt').length >= 2, true, 'process restart retains source branches');
    await type('textarea[name="prompt"]', `New active edit after restart ${locale}`);
    preferences.refresh(); notifyDrafts();
    await pause(100);
    assert.equal(await run('document.querySelector("textarea[name=prompt]").value'), `New active edit after restart ${locale}`);
    await openSettings();
    assert.equal(await run('document.querySelector("input[name=completion-notifications]").checked'), false);
    assert.equal(await run('document.querySelector("input[name=settings-follow-display][value=shared]").checked'), true);
    assert.equal(await run('document.querySelector("input[name=draft-sync]").checked'), true);
    await closeSettings();
    await type('textarea[name="prompt"]', '');
    await click('[data-draft-open]');
    await wait('!!document.querySelector(".draft-copy-list")');
    await clickElement(`[...document.querySelectorAll('.draft-copy-list li')].find(e=>e.querySelector('small').textContent===${JSON.stringify(copy.draftRemote)}).querySelector('button')`);
    await clickText('.draft-actions button', copy.draftRestore);
    await wait('!!document.querySelector(".draft-confirm")');
    assert.equal(await run('document.querySelector("textarea[name=prompt]").value'), '', 'empty prompt recovery still requires confirmation');
    await click('.draft-confirm .confirm-actions button:not(.primary)');
    assert.equal(await run('document.querySelector("textarea[name=prompt]").value'), '');
    key('Escape');
    await wait('!document.querySelector(".folder-modal")');
  }
  await require('./preferences-drafts-native-editors.cjs')({ tools, locale, phase, copy, drafts,
    remoteDrafts, engine, remoteEngine, preferences, notifyDrafts });
  assert.equal(await run('nativeInputs.some(e=>e.type==="input" && e.name==="prompt" && e.trusted)'), true);
  assert.equal(forbidden, 0);
  assert.equal(drafts.list().length, 8);
  if (phase === 'write') await run(`localStorage.setItem('polyask.display', JSON.stringify({density:'compact',siteScale:1}))`);
  fs.writeFileSync(join(output, `${locale}-${phase}.png`), (await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(join(output, `${locale}-${phase}.json`), JSON.stringify({ locale, phase, blocked, forbidden,
    preferences: preferences.snapshot(), drafts: drafts.list().map(value => ({ id: value.id, kind: value.kind, deviceId: value.deviceId })) }, null, 2));
  console.log(JSON.stringify({ locale, phase, nativePages: views.length, blocked, forbidden, draftCount: drafts.list().length }));
  engine.dispose(); remoteEngine.dispose(); database.close(); remote.close(); win.destroy(); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
