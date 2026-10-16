const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const platform of ['win32', 'darwin']) {
    for (const width of [960, 1280, 1400, 1440, 480]) {
      win.webContents.setZoomFactor(1); win.setContentSize(width, 800);
      await win.loadFile(join(output, 'index.html'), { query: { surface: 'shortcuts', locale, platform } });
      await wait('!!document.querySelector(".command-results kbd")'); await paint();
      const result = await run(`(() => {
        const keys=[...document.querySelectorAll('.command-results kbd')].filter(e=>e.textContent.trim());
        const visible=keys.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
        return {total:keys.length,visible:visible.length,overflow:[...document.querySelectorAll('.command-results > button')]
          .some(e=>e.scrollWidth>e.clientWidth+1),names:visible.map(e=>e.textContent)};
      })()`);
      assert.equal(result.total > 0, true);
      assert.equal(result.visible, result.total, `${locale}/${platform}/${width}: shortcut reference must expose every key`);
      assert.equal(result.overflow, false, `${locale}/${platform}/${width}: shortcut rows fit`);
      reports.push({ locale, platform, width, ...result });
      if (locale === 'en' && platform === 'win32' && width === 1280) await shot('shortcuts-1280');
    }
  }
  await run('document.querySelector("#command-tab-commands").focus()');
  for (const type of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' });
  await wait('!!document.querySelector(".command-search input")');
  const visible = await run(`[...document.querySelectorAll('.command-results kbd')].filter(e=>e.textContent.trim()).every(e=>e.getClientRects().length>0)`);
  assert.equal(visible, true, 'command search also keeps its shortcut hints');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Enter' });
  await wait('!!document.body.dataset.executed');
  writeFileSync(join(output, 'shortcut-reference.json'), JSON.stringify(reports, null, 2));
  console.log(`Shortcut reference passed: ${reports.length} locale/platform/width scenarios.`);
};
