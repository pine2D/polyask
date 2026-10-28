const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');
const accessibility = require('./ui-accessibility.cjs');
const categories = ['appearance', 'interaction', 'sync', 'backup', 'network', 'data', 'about'];

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  const key = async keyCode => { for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode }); await paint(); };
  const navigate = async category => {
    const zoom = win.webContents.getZoomFactor(); win.focus();
    const narrow = await run('getComputedStyle(document.querySelector(".settings-category-select")).display !== "none"');
    if (narrow) {
      const point = await run('(()=>{const r=document.querySelector(".settings-category-select").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
      await paint();
      if (process.platform === 'linux') {
        execFileSync('xdotool', ['key', '--clearmodifiers', 'Home', ...Array(categories.indexOf(category)).fill('Down'), 'Return']);
      } else {
        await key('Home');
        for (let index = 0; index < categories.indexOf(category); index++) await key('Down');
        await key('Return');
      }
    } else {
      const point = await run(`(() => { const e=document.querySelector('[data-settings-section=${category}]'); e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    }
    try { await wait(`document.querySelector('[data-settings-category]:not([hidden])')?.dataset.settingsCategory === '${category}'`); }
    catch (error) {
      console.log('Category input failure', await run('({current:document.querySelector(".settings-category-select").value,focus:document.activeElement?.id,width:innerWidth,zoom:devicePixelRatio})'));
      await shot('settings-category-input-failure'); throw error;
    }
    await paint();
    assert.equal(await run(narrow ? 'document.activeElement.matches(".settings-category-select")' : `document.activeElement.id === 'settings-category-${category}'`), true);
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const density of ['compact', 'comfortable']) {
    for (const theme of ['light', 'dark']) for (const width of [480, 960, 1280]) for (const zoom of [1, 1.5]) {
      nativeTheme.themeSource = theme; win.setContentSize(width, 900);
      await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale, density } });
      win.webContents.setZoomFactor(zoom);
      await wait('document.querySelector("[aria-current=location]")?.dataset.settingsSection === "appearance"');
      await paint();
      assert.equal(Math.abs(await run('innerWidth') * zoom - width) <= 2, true, 'actual category viewport matches requested zoom');
      const result = { locale, density, theme, width, zoom, categories: [] };
      for (const category of [...categories.slice(1), 'appearance']) {
        await navigate(category);
        const geometry = await run(`(() => { const panel=document.querySelector('[data-settings-category]:not([hidden])');
          const elements=[...panel.querySelectorAll('.settings-card,button,input,select,textarea,.settings-control-hint')].filter(e=>e.getClientRects().length);
          return {visible:document.querySelectorAll('[data-settings-category]:not([hidden])').length,
            hidden:[...document.querySelectorAll('[data-settings-category][hidden]')].every(e=>e.inert && !e.getClientRects().length),
            fit:elements.every(e=>e.scrollWidth<=e.clientWidth+2&&e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=0),
            nav:document.querySelector('.settings-category-select').value, width:innerWidth}; })()`);
        assert.equal(geometry.visible, 1); assert.equal(geometry.hidden, true);
        assert.equal(geometry.fit, true, `category layout ${JSON.stringify({ ...result, category, geometry })}`);
        assert.equal(geometry.nav, category);
        if (locale === 'zh-CN' && density === 'compact' && zoom === 1 && width !== 960 && ['appearance', 'interaction', 'sync'].includes(category)) await shot(`settings-${category}-${theme}-${width}`);
        await run('document.querySelector(".settings-toolbar button").focus();document.querySelector(".settings-grid").scrollTop+=100');
        assert.equal(await run('document.activeElement===document.querySelector(".settings-toolbar button")'), true);
        assert.equal(await run('document.querySelector("[aria-current=location]").dataset.settingsSection'), category, 'scrolling cannot select another category');
        result.categories.push(category);

      }
      await key('Tab');
      assert.equal(await run('!!document.activeElement.closest("[hidden],[inert]")'), false, 'Tab does not enter a hidden category');
      assert.equal((await accessibility(win)).filter(node => node.role === 'status').length, 1);
      reports.push(result);
    }
  }
  win.webContents.setZoomFactor(1);
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    win.setContentSize(1280, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    await wait('!!document.querySelector(".scope-presets")');
    const labels = await run('[".mode-switch", ".tier-switch", ".scope-presets"].map(selector=>document.querySelector(selector).getAttribute("aria-label"))');
    const tree = await accessibility(win);
    labels.forEach(label => assert.equal(tree.some(node => node.role === 'group' && node.name === label), true, 'control names appear as groups in Chromium accessibility'));
  }
  writeFileSync(join(output, 'settings-section-report.json'), JSON.stringify(reports, null, 2));
};
