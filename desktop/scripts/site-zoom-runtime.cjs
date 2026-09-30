const { app, BrowserWindow, WebContentsView, Menu, session, protocol } = require('electron');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const output = process.argv[2];
const { SiteZoomController, UiStateStore, applyWorkspaceLayout, metricsForDensity, DEFAULT_DISPLAY_PREFERENCES } = require(join(output, 'production.cjs'));
app.setPath('userData', join(output, 'profile'));
protocol.registerSchemesAsPrivileged([{ scheme: 'polyask-zoom-test', privileges: { standard: true, secure: true } }]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const inputTrace = [];
// Electron sendInputEvent delivers a wheel to Blink but skips Chromium's native
// Ctrl+wheel zoom path. XTest exercises that path inside this isolated Xvfb server.
const wheel = (win, view, button) => {
  const window = win.getContentBounds(), bounds = view.getBounds();
  execFileSync('python3', ['-c', `
import ctypes as c, sys
x = c.CDLL('libX11.so.6'); t = c.CDLL('libXtst.so.6')
x.XOpenDisplay.restype = c.c_void_p
d = x.XOpenDisplay(None)
if not d: raise RuntimeError('No X11 display')
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]
x.XFlush.argtypes = [c.c_void_p]
x.XCloseDisplay.argtypes = [c.c_void_p]
t.XTestFakeMotionEvent.argtypes = [c.c_void_p, c.c_int, c.c_int, c.c_int, c.c_ulong]
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
t.XTestFakeButtonEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
control = x.XKeysymToKeycode(d, 0xffe3)
t.XTestFakeMotionEvent(d, -1, int(sys.argv[1]), int(sys.argv[2]), 0)
t.XTestFakeKeyEvent(d, control, 1, 0)
t.XTestFakeButtonEvent(d, int(sys.argv[3]), 1, 0)
t.XTestFakeButtonEvent(d, int(sys.argv[3]), 0, 0)
t.XTestFakeKeyEvent(d, control, 0, 0)
x.XFlush(d); x.XCloseDisplay(d)
`, String(window.x + bounds.x + 100), String(window.y + bounds.y + 100), String(button)]);
};
const wait = async predicate => {
  const deadline = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Zoom input did not reach the expected factor: ${JSON.stringify(inputTrace)}`);
    await pause(20);
  }
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  await session.defaultSession.protocol.handle('polyask-zoom-test', () => new Response('<!doctype html><textarea>Offline AI page</textarea><div style="height:5000px">Scroll content</div>'));
  const win = new BrowserWindow({ width: 1300, height: 900, show: true, webPreferences: { sandbox: true } });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] }]));
  await win.loadFile(join(output, 'shell.html'));
  const store = new UiStateStore(join(output, 'desktop-ui-state.json'));
  const base = { maximized: false, layoutMode: 'overview', currentPage: 0, focusedByPage: { 0: 'claude' } };
  const zoom = new SiteZoomController(() => store.schedule({ ...base, siteZoom: zoom.snapshot() }));
  const views = new Map();
  for (const [site, url] of [['claude', 'polyask-zoom-test://shared/claude'], ['kimi', 'polyask-zoom-test://shared/kimi']]) {
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.contentView.addChildView(view);
    views.set(site, view);
    zoom.bind(site, view.webContents);
    view.webContents.on('zoom-changed', (_event, direction) => inputTrace.push({ site, direction, zoom: view.webContents.getZoomFactor() }));
    view.webContents.on('input-event', (_event, input) => { if (input.type.includes('Wheel')) inputTrace.push({ site, input }); });
    view.webContents.on('before-mouse-event', (_event, input) => { if (input.type.includes('Wheel')) inputTrace.push({ site, mouse: input }); });
    await view.webContents.loadURL(url);
  }
  const layout = { views, placements: [...views.keys()].map((key, i) => ({ key, bounds: { x: i * 620, y: 60, width: 600, height: 750 } })),
    metrics: metricsForDensity('compact'), zoom: 1, display: DEFAULT_DISPLAY_PREFERENCES, mode: 'overview', focused: 'claude', siteZoom: zoom };
  applyWorkspaceLayout(layout);
  const first = views.get('claude').webContents, second = views.get('kimi').webContents;
  const factor = contents => Math.round(contents.getZoomFactor() * 100) / 100;
  const key = (contents, keyCode, modifiers = ['control']) => {
    win.focus(); contents.focus();
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  key(first, '='); await wait(() => factor(first) === 1);
  key(first, '+', ['control', 'shift']); await wait(() => factor(first) === 1.1);
  assert.equal(factor(second), 0.9);
  assert.equal(factor(win.webContents), 1, 'site shortcut must not zoom the shell');
  applyWorkspaceLayout({ ...layout, mode: 'focus' });
  assert.equal(factor(first), 1.1, 'layout must retain the manual override');
  key(first, '-'); await wait(() => factor(first) === 1);
  wheel(win, views.get('claude'), 4);
  await wait(() => factor(first) === 1.1);
  wheel(win, views.get('claude'), 5);
  await wait(() => factor(first) === 1);
  key(second, '-'); await wait(() => factor(second) === 0.8);
  key(second, '0'); await wait(() => factor(second) === 1);
  key(first, '+', ['control', 'shift']); await wait(() => factor(first) === 1.1);
  await first.reload();
  await new Promise(resolve => first.once('did-finish-load', resolve));
  assert.equal(factor(first), 1.1, 'reload must retain the manual override');
  await first.loadURL('polyask-zoom-test://login/claude');
  await second.loadURL('polyask-zoom-test://login/kimi');
  assert.equal(first.getZoomMode(), 'isolated');
  assert.equal(second.getZoomMode(), 'isolated');
  assert.equal(factor(first), 1.1, 'login navigation retains first site zoom');
  assert.equal(factor(second), 1, 'shared login origin retains second site zoom');
  key(first, '+', ['control', 'shift']); await wait(() => factor(first) === 1.25);
  assert.equal(factor(second), 1, 'shared login origin must not share zoom');
  key(first, '-'); await wait(() => factor(first) === 1.1);
  store.flush();
  const saved = store.load();
  const restored = new SiteZoomController(() => {});
  restored.restore(saved.siteZoom);
  const replacement = new WebContentsView({ webPreferences: { sandbox: true } });
  win.contentView.addChildView(replacement);
  replacement.setBounds({ x: 0, y: 60, width: 600, height: 750 });
  restored.bind('claude', replacement.webContents);
  await replacement.webContents.loadURL('polyask-zoom-test://login/restored');
  restored.apply('claude', replacement.webContents, 0.9);
  assert.equal(factor(replacement.webContents), 1.1, 'saved local state must restore on a new view');
  zoom.clear(); store.flush();
  assert.deepEqual(store.load().siteZoom, {});
  writeFileSync(join(output, 'report.json'), JSON.stringify({ electron: process.versions.electron, saved, checks: ['Ctrl+=', 'Ctrl++', 'Ctrl+-', 'Ctrl+0', 'Ctrl+wheel in/out', 'shared-origin isolation', 'shared login navigation', 'shell unchanged', 'layout', 'reload', 'saved-state restore', 'local reset'] }, null, 2));
  console.log('Site zoom passed: native keys/wheel, per-site isolation, layout/reload, saved-state restore and reset.');
  for (const view of [...views.values(), replacement]) view.webContents.close();
  store.dispose(); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
