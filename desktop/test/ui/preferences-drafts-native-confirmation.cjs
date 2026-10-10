const assert = require('node:assert/strict');

/** Trusted native keys exercise both the application menu and the production root. */
module.exports = async ({ tools, win, manager, views, commands, surface }) => {
  const { key, click, wait, run, pause } = tools;
  const original = manager.getLayout(), nativeHistory = views[0].webContents.navigationHistory;
  assert.equal(nativeHistory.canGoBack(), true, 'the local page has real back history to protect');
  const urls = views.map(view => view.webContents.getURL());
  const covered = async () => {
    assert.equal(surface(), 'confirmation');
    assert.equal(manager.getLayout().page, original.page);
    assert.equal(manager.getLayout().focused, original.focused);
    assert.equal(win.contentView.children.filter(view => views.includes(view)).length, 5);
    assert.equal(views.every(view => !view.getVisible() && view.getBounds().width > 0 && view.getBounds().height > 0), true);
    assert.equal(views.every((view, index) => view.webContents.getURL() === urls[index]), true);
    assert.equal(await run('document.querySelectorAll("[role=dialog]").length'), 1);
    assert.equal(await run('document.hasFocus() && !!document.activeElement.closest("[role=dialog]")'), true);
  };
  await covered();
  for (const [id, code, modifiers] of [
    ['focus-prompt', 'Q', ['alt']], ['new-session', 'N', ['alt']], ['show-page-2', '2', ['alt']],
    ['collect-answers', 'C', ['alt']], ['set-think', 'T', ['alt']], ['set-fast', 'Y', ['alt']],
    ['next-site', 'PageDown', ['control']], ['next-page', 'PageDown', ['control', 'shift']],
    ['site-back', 'Left', ['alt']], ['open-settings', ',', ['control']]
  ]) {
    const before = commands.length;
    key(code, modifiers);
    const deadline = Date.now() + 3000;
    while (!commands.slice(before).includes(id)) {
      if (Date.now() >= deadline) throw Error('Native accelerator did not reach main: ' + id);
      await pause(20);
    }
    await pause(40); await covered();
  }
  // Bypass the native dispatch to prove renderer gating independently.
  for (const id of ['focus-prompt', 'new-session', 'open-settings', 'open-archive', 'collect-compare']) {
    win.webContents.send('polyask:command', id); await pause(40); await covered();
  }
  assert.equal(manager.navigateHistory('claude', -1), false);
  key('Escape'); await wait('!document.querySelector("[role=dialog]")');
  key('N', ['alt']); await wait('!!document.querySelector("#confirm-title")');
  assert.equal(surface(), 'confirmation');
  assert.equal(await run('document.querySelectorAll("[role=dialog]").length'), 1);
  key('Escape'); await wait('!document.querySelector("[role=dialog]")');
  key(',', ['control']); await wait('!!document.querySelector(".settings-workspace")');
  manager.pageDirect(1); assert.equal(manager.getLayout().page, 1, 'settings retains background page changes');
  manager.focusRelative(1);
  assert.equal(await run('document.hasFocus()'), true, 'background focus choices cannot focus detached native views');
  await click('.settings-toolbar .panel-close'); await wait('!!document.querySelector("textarea[name=prompt]")');
  manager.setPage(original.page); manager.setLayout(original.mode, original.focused, false);
  await click('[data-draft-open]'); await wait('!!document.querySelector(".folder-modal")');
  await covered();
  return { nativeKeys: 10, rendererCommands: 5, pages: views.length, newSessionConfirmed: false };
};
