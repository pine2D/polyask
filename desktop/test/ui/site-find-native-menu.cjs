const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
module.exports = async ({ win, run, until, paint, click, manager, menuTrace, keys, output, locale }) => {
  const press = async (contents, keyCode) => {
    for (const type of ['keyDown', 'keyUp']) contents.sendInputEvent({ type, keyCode });
    await new Promise(resolve => setTimeout(resolve, 60));
  };
  manager.siteFind.select(keys[8]); await paint();
  await click('[name=site-find-menu]');
  await until(() => menuTrace.open && !!menuTrace.view, 'Platinum popup opens');
  assert.equal(win.contentView.children.at(-1) === menuTrace.view, true, 'Platinum popup view stacks above all nine site views');
  const popupPaint = () => menuTrace.view.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await popupPaint();
  writeFileSync(join(output, 'menu-' + locale + '.png'), (await win.capturePage()).toPNG());
  await press(menuTrace.view.webContents, 'Home');
  await press(menuTrace.view.webContents, 'Return');
  await until(() => !menuTrace.open, 'Platinum menu keyboard choice');
  await until(() => manager.siteFind.state.activeSite === keys[0], 'Platinum menu selected first matching site');
  await until(() => run('document.activeElement?.name==="site-find-query"'), 'menu restores query focus');

  manager.siteFind.select(keys[8]); await paint();
  await click('[name=site-find-menu]');
  await until(() => menuTrace.open && !!menuTrace.view, 'Platinum pointer popup');
  await popupPaint();
  const box = await menuTrace.view.webContents.executeJavaScript(`(() => {
    const m = document.getElementById('menu').getBoundingClientRect();
    const first = document.querySelector('.plat-item:not([aria-disabled="true"])').getBoundingClientRect();
    return { width: m.width, x: first.left + first.width / 2, y: first.top + first.height / 2 };
  })()`);
  assert.equal(box.width <= 440, true, 'scope notes keep the Platinum menu compact');
  const zoom = menuTrace.view.webContents.getZoomFactor();
  for (const type of ['mouseDown', 'mouseUp']) {
    menuTrace.view.webContents.sendInputEvent({
      type, button: 'left', clickCount: 1,
      x: Math.round(box.x * zoom), y: Math.round(box.y * zoom)
    });
  }
  await until(() => !menuTrace.open, 'Platinum pointer choice');
  await until(() => manager.siteFind.state.activeSite === keys[0], 'Platinum pointer selects site');
  await until(() => run('document.activeElement?.name==="site-find-query"'), 'pointer menu restores query focus');

  const beforeRefresh = manager.siteFind.state.revision;
  await run('document.querySelector("[name=site-find-menu]").focus()');
  await press(win.webContents, 'Space');
  await until(() => menuTrace.open && !!menuTrace.view, 'keyboard opens Platinum menu');
  await press(menuTrace.view.webContents, 'End');
  await press(menuTrace.view.webContents, 'Return');
  await until(() => !menuTrace.open && manager.siteFind.state.revision > beforeRefresh && manager.siteFind.state.sites.every(s => s.status !== 'pending'), 'keyboard refresh');

  const revision = manager.siteFind.state.revision;
  await run('document.querySelector("[name=site-find-menu]").focus()');
  await press(win.webContents, 'Space');
  await until(() => menuTrace.open && !!menuTrace.view, 'Platinum cancel popup');
  await press(menuTrace.view.webContents, 'Escape');
  await until(() => !menuTrace.open, 'Escape dismisses Platinum menu');
  assert.equal(manager.siteFind.state.open, true, 'Escape dismisses only the popup menu');
  assert.equal(manager.siteFind.state.revision, revision, 'cancel never reruns the search');
  await until(() => run('document.activeElement?.name==="site-find-query"'), 'cancel restores query focus');
};
