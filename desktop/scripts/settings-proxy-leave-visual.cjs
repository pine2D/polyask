const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    win.webContents.setZoomFactor(1); win.setContentSize(960, 800);
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'proxy-edit', locale } });
    await wait('!!document.querySelector("#settings-proxy-host")');
    await run('document.querySelector("#settings-proxy-host").focus();document.querySelector("#settings-proxy-host").select()');
    await win.webContents.insertText('draft.example');
    await run('document.querySelector("#settings-proxy-password").focus()');
    await win.webContents.insertText('synthetic-secret');
    const escape = async () => { for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Escape' }); await paint(); };
    await escape(); await wait('!!document.querySelector(".confirm-dialog")');
    assert.equal(await run('document.activeElement===document.querySelector(".confirm-actions button:not(.primary)")'), true, 'keep editing is default');
    for (let i = 0; i < 6; i++) {
      for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Tab' });
      assert.equal(await run('document.querySelector(".confirm-dialog").contains(document.activeElement)'), true, 'focus stays in confirmation');
    }
    await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",keyCode:229,bubbles:true}))');
    assert.equal(await run('!!document.querySelector(".confirm-dialog")'), true, 'IME escape keeps confirmation');
    if (locale === 'zh-CN') await shot('proxy-unsaved-confirmation');
    await escape(); await wait('!document.querySelector(".confirm-dialog")');
    assert.equal(await run('document.activeElement===document.querySelector("#settings-proxy-password")'), true, 'cancel restores input focus');
    assert.equal(await run('document.querySelector("#settings-proxy-host").value==="draft.example"&&document.querySelector("#settings-proxy-password").value==="synthetic-secret"'), true);
    await escape(); await wait('!!document.querySelector(".confirm-dialog")');
    await run('document.querySelector(".confirm-actions .primary").click()');
    await wait('!document.querySelector(".settings-workspace")');
    await run('document.querySelector("[data-proxy-reopen]").click()');
    await wait('!!document.querySelector("#settings-proxy-host")');
    assert.equal(await run('document.querySelector("#settings-proxy-host").value==="proxy.example"&&document.querySelector("#settings-proxy-password").value===""'), true);
    reports.push({ locale, cancelledInputPreserved: true, realUnmountAndReopen: true, focusTrap: true, physicalIme: 'not-tested' });
  }
  writeFileSync(join(output, 'proxy-leave.json'), JSON.stringify(reports, null, 2));
  console.log(`Proxy leave protection passed: ${reports.length} locale scenarios.`);
};
