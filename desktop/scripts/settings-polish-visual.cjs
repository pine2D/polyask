const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');

// 当前生产设置组件；所有写入仅更新夹具状态，不连接真实服务。
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    // Chromium 原生 summary 的 Enter 激活需要完整字符事件，与真实回车一致。
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await paint();
  };
  const click = async selector => {
    const point = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
      x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    await paint();
  };
  const category = async value => {
    await run(`document.querySelector('[data-settings-section=${value}]').click()`);
    await wait(`document.querySelector('[data-settings-category]:not([hidden])')?.dataset.settingsCategory === '${value}'`);
    await paint();
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) for (const zoom of [1, 2]) {
    nativeTheme.themeSource = theme;
    win.setContentSize(1440, 1000); win.webContents.setZoomFactor(zoom);
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale, platform: 'win32' } });
    await wait('!!document.querySelector(".settings-layout")');
    await paint();
    const frame = { locale, theme, zoom };
    await category('interaction');
    const type = await run(`(() => { const size = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      return {page:size('#settings-category-interaction'),section:size('#settings-confirmations-title'),
        item:size('.settings-confirmations .preference-title'),meta:size('#notification-test-hint'),
        testGap:document.querySelector('.settings-notification-test').getBoundingClientRect().top-document.querySelector('[aria-labelledby=completion-notifications-title]>.preference-card').getBoundingClientRect().bottom}; })()`);
    assert.equal(type.page > type.section && type.section > type.item, true, `heading hierarchy ${JSON.stringify({ ...frame, type })}`);
    assert.equal(type.meta >= 12, true, 'auxiliary text must not inherit the UA small size');
    assert.equal(type.testGap >= 16, true, 'notification testing is a separate group');
    if (locale === 'zh-CN' && zoom === 1) await shot(`settings-polish-interaction-${theme}`);

    await category('sync');
    const sync = await run(`(() => { const card=document.querySelector('.sync-overview'),toggle=card.querySelector('.preference-switch');
      const r=card.getBoundingClientRect(),s=getComputedStyle(card);
      return {switchGap:r.right-parseFloat(s.paddingRight)-parseFloat(s.borderRightWidth)-toggle.getBoundingClientRect().right,
        headings:document.querySelectorAll('[data-settings-category=sync] h1').length,
        folded:!document.querySelector('.settings-preference-details').open,
        scopesVisible:[...document.querySelectorAll('[data-settings-category=sync] [data-preference-scope]')].every(e=>e.getClientRects().length>0),
        rulesVisible:document.querySelector('#settings-follow-hint').getClientRects().length>0}; })()`);
    assert.equal(Math.abs(sync.switchGap) <= 1, true, `image switch right edge ${JSON.stringify({ ...frame, sync })}`);
    assert.equal(sync.headings, 1); assert.equal(sync.folded, true);
    assert.equal(sync.scopesVisible && sync.rulesVisible, true, 'shared consequences remain visible before opting in');
    if (locale === 'zh-CN') await shot(`settings-polish-sync-${theme}-${zoom}`);
    await run('document.querySelector(".settings-preference-details>summary").focus()');
    win.focus(); win.webContents.focus(); await key('Enter');
    assert.equal(await run('document.querySelector(".settings-preference-details").open'), true, 'Enter expands source details');
    assert.equal(await run('[...document.querySelectorAll("[data-preference-source]")].every(e=>e.getClientRects().length>0)'), true);
    await key('Enter');
    assert.equal(await run('document.querySelector(".settings-preference-details").open'), false);
    await click('.settings-inline-action');
    assert.equal(await run('document.activeElement.id'), 'settings-layout-title');
    assert.equal(await run('document.querySelector("[data-settings-category]:not([hidden])").dataset.settingsCategory'), 'appearance');
    await key('Tab');
    assert.equal(await run('document.activeElement.name'), 'settings-layout-mode', 'the next Tab enters the relocated editor');
    await click('input[name=settings-layout-mode][value=focus]');
    await wait('document.querySelector("input[name=settings-layout-mode][value=focus]").checked');
    await category('sync');
    assert.equal(await run('document.querySelector("[data-preference-group=layout] [data-preference-current]").textContent === document.querySelector("input[name=settings-layout-mode][value=focus]+span").textContent'), true, 'sync summary reflects the accepted layout');
    await click('.settings-inline-action');
    assert.equal(await run('document.querySelector("input[name=settings-layout-mode][value=focus]").checked'), true);
    if (locale === 'zh-CN' && zoom === 1) await shot(`settings-polish-appearance-${theme}`);
    const geometry = await run(`(() => { const p=document.querySelector('[data-settings-category]:not([hidden])');
      return {viewport:innerWidth,body:document.documentElement.scrollWidth,
        fits:[...p.querySelectorAll('button,input,select,p,h2,fieldset')].filter(e=>e.getClientRects().length)
          .every(e=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+2)}; })()`);
    assert.equal(geometry.body <= geometry.viewport && geometry.fits, true, `relocated layout fits ${JSON.stringify({ ...frame, geometry })}`);
    reports.push({ ...frame, type, sync, geometry });
  }
  win.webContents.setZoomFactor(1);
  writeFileSync(join(output, 'settings-polish-report.json'), JSON.stringify(reports, null, 2));
  console.log('Settings polish passed: 12 locale/theme/zoom cases with hierarchy, switch alignment, keyboard disclosure and layout navigation.');
};
