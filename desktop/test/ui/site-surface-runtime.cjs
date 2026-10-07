const { app, BrowserWindow, WebContentsView, session } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
const { transitionSiteSurface } = require(join(output, 'site-surface.cjs'));
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const check = (ok, message) => { if (!ok) throw Error(message); };
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1100, height: 800, show: true });
  await win.loadURL('data:text/html,<p>Isolated shell</p>');
  const pages = [];
  for (let index = 0; index < 2; index++) {
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 50, width: 400, height: 500 });
    await view.webContents.loadURL('data:text/html,<p>Local site viewport</p>');
    view.setVisible(index === 0); pages.push(view);
  }
  const effects = {
    detach: () => { for (const view of pages) win.contentView.removeChildView(view); },
    cover: covered => { for (const view of win.contentView.children) view.setVisible(!covered); },
    restore: () => { for (const [index, view] of pages.entries()) {
      win.contentView.addChildView(view); view.setVisible(index === 0);
    } }
  };
  const dimensions = () => Promise.all(pages.map(view => view.webContents.executeJavaScript('({width:innerWidth,height:innerHeight})')));
  const before = await dimensions();
  check(before.every(size => size.width > 0 && size.height > 0), 'native attached pages start with positive viewports');
  transitionSiteSurface('sites', 'confirmation', effects);
  await new Promise(resolve => setTimeout(resolve, 100));
  const covered = await dimensions();
  check(win.contentView.children.length === 2 && pages.every(view => !view.getVisible()), 'confirmation hides both attached native views');
  check(covered.every((size, index) => size.width === before[index].width && size.height === before[index].height), 'confirmation preserves actual renderer viewports');
  transitionSiteSurface('confirmation', 'sites', effects);
  check(pages[0].getVisible() && !pages[1].getVisible(), 'restoration keeps an unselected busy site hidden');
  transitionSiteSurface('sites', 'confirmation', effects);
  transitionSiteSurface('confirmation', 'archive', effects);
  check(win.contentView.children.length === 0, 'workspace still detaches the native sites');
  console.log(JSON.stringify({ before, covered, restoredSelectedOnly: true, workspaceDetached: true }));
  console.log('NATIVE_SURFACE_COMPLETE');
  for (const view of pages) view.webContents.close();
  win.destroy(); app.exit(0);
}).catch(error => { console.error(String(error)); app.exit(1); });
