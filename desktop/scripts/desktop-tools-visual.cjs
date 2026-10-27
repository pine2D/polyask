const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { app, nativeTheme } = require('electron');
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const accessibility = require('./ui-accessibility.cjs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [], sample = processBoundary(app, output);
  const key = async (keyCode, text) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    if (text) win.webContents.sendInputEvent({ type: 'char', keyCode: text });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await paint();
  };
  const focus = async selector => {
    await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'}); e.focus(); })()`);
    await paint();
    assert.equal(await run(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`), true);
  };
  const geometry = async selector => run(`(() => {const card=document.querySelector(${JSON.stringify(selector)}), r=card.getBoundingClientRect();
    return {width:card.clientWidth,scroll:card.scrollWidth,left:r.left,right:r.right,viewport:innerWidth,
      controls:[...card.querySelectorAll('button,select,input,legend,p,small')].map(e=>{const b=e.getBoundingClientRect();
        return {tag:e.tagName,left:b.left,right:b.right,width:e.clientWidth,scroll:e.scrollWidth};})};})()`);
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    for (const [width, zoom, density] of [[1280, 1, 'compact'], [960, 1.5, 'comfortable']]) {
      nativeTheme.themeSource = theme; win.webContents.setZoomFactor(zoom); win.setContentSize(width, 1000);
      await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale, density } });
      await wait('!!document.querySelector("#global-prompt-shortcut-key") && !document.querySelector(".settings-global-shortcut fieldset").disabled');
      await run('document.querySelector("[data-settings-section=interaction]").click()');
      sample();
      await focus('.settings-global-shortcut input[value="Control"]');
      if (theme === 'dark' && zoom === 1.5) await shot(`desktop-tools-shortcut-default-${locale}`);
      await key('Space', ' ');
      await key('Tab'); await key('Tab'); await key('Space', ' ');
      assert.equal(await run('document.querySelector(".settings-global-shortcut input[value=Alt]").checked'), true, 'Tab and Space select the second modifier');
      await focus('#global-prompt-shortcut-key'); await key('Q', 'q');
      await wait('document.querySelector("#global-prompt-shortcut-key").value === "Q"');
      await key('Tab');
      assert.equal(await run('document.activeElement === document.querySelector(".settings-global-shortcut button[type=submit]")'), true);
      await run('document.body.dataset.shortcutPending="true"'); await key('Enter', '\r');
      await wait('document.querySelector(".settings-global-shortcut fieldset").disabled');
      assert.equal(await run('document.body.dataset.shortcutWrites'), '1');
      await run('document.dispatchEvent(new Event("fixture:finish-shortcut"));document.body.dataset.shortcutPending="false"');
      await wait('document.body.dataset.shortcutValue === "Control+Alt+Q" && !document.querySelector(".settings-global-shortcut fieldset").disabled');
      assert.equal(await run('document.activeElement.id'), 'global-prompt-shortcut-title', 'saved state keeps focus on the card when save becomes disabled');
      assert.match(await run('document.querySelector("#global-prompt-shortcut-status").textContent'), /Ctrl\+Alt\+Q/);
      await focus('#global-prompt-shortcut-key'); await key('W', 'w'); await key('Tab');
      await run('document.body.dataset.shortcutConflict="true"'); await key('Enter', '\r');
      await wait('document.body.dataset.shortcutWrites === "2"');
      assert.equal(await run('document.querySelector("#global-prompt-shortcut-key").value'), 'W');
      assert.equal(await run('document.body.dataset.shortcutValue'), 'Control+Alt+Q', 'conflict preserves effective binding');
      assert.match(await run('document.querySelector("#global-prompt-shortcut-status").textContent'), /Ctrl\+Alt\+Q/);
      const conflictFocus = await run(`({tag:document.activeElement.tagName,id:document.activeElement.id,
        saveFocused:document.activeElement===document.querySelector('.settings-global-shortcut button[type=submit]'),
        saveDisabled:document.querySelector('.settings-global-shortcut button[type=submit]').disabled})`);
      assert.equal(conflictFocus.saveFocused, true, `failure returns visible focus to save: ${JSON.stringify(conflictFocus)}`);
      const shortcut = await geometry('.settings-global-shortcut');
      for (const box of [shortcut, ...shortcut.controls]) assert.equal(box.scroll <= box.width + 2, true, `${locale}/${theme}/${zoom}: shortcut text/control overflow`);
      assert.equal(shortcut.left >= 0 && shortcut.right <= shortcut.viewport, true);
      await shot(`desktop-tools-shortcut-${locale}-${theme}-${zoom}`);
      const selector = 'section[aria-labelledby="completion-notifications-title"]';
      await focus(`${selector} button`);
      const idle = await run('document.querySelector("#notification-test-status").textContent');
      await key('Enter', '\r');
      await wait('document.body.dataset.notificationTests === "1"');
      assert.equal(await run(`document.querySelector('${selector} button').disabled`), true, 'pending notification test cannot run twice');
      if (theme === 'dark' && zoom === 1.5) await shot(`desktop-tools-notification-pending-${locale}`);
      const requested = await run('document.querySelector("#notification-test-status").textContent');
      assert.notEqual(requested, idle);
      const notificationStates = [requested];
      for (const state of ['failed', 'unsupported', 'unknown', 'shown']) {
        await run(`document.dispatchEvent(new CustomEvent('fixture:notification-result',{detail:'${state}'}))`);
        await paint();
        assert.equal(await run(`document.querySelector('${selector} button').disabled`), false);
        assert.equal(await run(`document.activeElement === document.querySelector('${selector} button')`), true, 'terminal notification feedback restores visible keyboard focus');
        const message = await run('document.querySelector("#notification-test-status").textContent');
        assert.notEqual(message, requested); notificationStates.push(message);
        if (state === 'failed' && theme === 'dark' && zoom === 1.5) await shot(`desktop-tools-notification-failed-${locale}`);
      }
      assert.equal(new Set(notificationStates).size, 5, 'requested and each terminal state have distinct finite feedback');
      assert.equal(await run('document.querySelector("input[name=completion-notifications]").checked'), true, 'testing preserves the notification preference');
      const notification = await geometry(selector);
      for (const box of [notification, ...notification.controls].filter(box => box.width > 2)) assert.equal(box.scroll <= box.width + 2, true, `${locale}/${theme}/${zoom}: notification text/control overflow`);
      const tree = await accessibility(win);
      const labels = await run('[document.querySelector("#completion-notifications-title").textContent,document.querySelector(".settings-global-shortcut legend").textContent]');
      for (const label of labels) assert.equal(tree.some(node => node.name === label), true, 'new controls have Chromium accessibility names');
      await shot(`desktop-tools-notifications-${locale}-${theme}-${zoom}`);
      sample();
      reports.push({ locale, theme, width, zoom, density, shortcut, notification, keyboardSelection: true, conflictPreserved: true, finiteNotificationStates: true });
    }
  }
  writeFileSync(join(output, 'desktop-tools-report.json'), JSON.stringify({ electron: process.versions.electron, reports, scope: 'synthetic API states; no OS delivery or physical global hotkey verification' }, null, 2));
  console.log(`Desktop tool settings passed: ${reports.length} locale/theme/zoom variants with keyboard and failure-state checks.`);
};
