const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');
const accessibility = require('./ui-accessibility.cjs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  win.webContents.setZoomFactor(1);
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [640, 960, 1280]) {
    nativeTheme.themeSource = width === 1280 ? 'light' : 'dark';
    win.setContentSize(width, width === 960 ? 680 : 900);
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale, density: width === 1280 ? 'compact' : 'comfortable' } });
    await wait('document.querySelector("[aria-current=location]")?.dataset.settingsSection === "overview"');
    for (const section of ['proxy', 'updates']) {
      const target = await run(`(() => { const e=document.querySelector('[data-settings-section=${section}]'); e.scrollIntoView({block:'nearest',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...target, button: 'left', clickCount: 1 });
      await wait(`document.querySelector('[aria-current=location]')?.dataset.settingsSection === '${section}'`);
      await paint(); await paint();
      assert.equal(await run('document.querySelector("[aria-current=location]").dataset.settingsSection'), section, 'a clamped jump keeps its explicit section');
      assert.equal(await run('document.activeElement.id'), section === 'proxy' ? 'settings-proxy-title' : 'app-updates-title');
      if (width === 960 && section === 'proxy') await shot(`settings-proxy-position-${locale}`);
    }
    assert.equal((await accessibility(win)).filter(node => node.role === 'status').length, 1, 'settings feedback remains exposed as a status');
    const point = await run(`(() => { const e=document.querySelector('[data-settings-section=display]'); e.scrollIntoView({block:'nearest',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, ...point, button: 'left', clickCount: 1 });
    await wait('document.querySelector("[aria-current=location]")?.dataset.settingsSection === "display"');
    await wait('document.activeElement.id === "settings-display-title"');
    await paint();
    assert.equal(await run('document.querySelectorAll("[aria-current=location]").length'), 1);
    if (locale === 'zh-CN') await shot(`settings-current-${width}`);
    await run(`(() => { document.querySelector('.settings-toolbar button').focus(); const body=document.querySelector('.settings-body');
      body.scrollTop += document.querySelector('#backup-card-title').getBoundingClientRect().top-body.getBoundingClientRect().top-parseFloat(getComputedStyle(body).scrollPaddingTop); })()`);
    await wait('document.querySelector("[aria-current=location]")?.dataset.settingsSection === "backup"');
    assert.equal(await run('document.activeElement === document.querySelector(".settings-toolbar button")'), true, 'manual scrolling never steals keyboard focus');
    await run('document.querySelector(".settings-body").scrollTop = document.querySelector(".settings-body").scrollHeight');
    await paint(); await paint();
    assert.notEqual(await run('document.querySelector("[aria-current=location]").dataset.settingsSection'), 'data', 'the folded last section does not take over the visible content');
    const result = await run(`(() => { const nav=document.querySelector('.settings-section-scroller').getBoundingClientRect(), active=document.querySelector('[aria-current=location]').getBoundingClientRect();
      const button=document.querySelector('[aria-current=location]'), section=document.getElementById(button.getAttribute('aria-controls')).closest('.settings-card,.settings-advanced').getBoundingClientRect(), body=document.querySelector('.settings-body').getBoundingClientRect();
      return {left:active.left,right:active.right,navLeft:nav.left,navRight:nav.right,current:button.dataset.settingsSection,sectionVisible:section.bottom>nav.bottom&&section.top<body.bottom}; })()`);
    assert.ok(result.left >= result.navLeft - 1 && result.right <= result.navRight + 1, 'the current section stays visible in the horizontal navigation');
    assert.equal(result.sectionVisible, true, 'passive tracking identifies visible section content');
    reports.push({ locale, width, ...result });
    if (width === 1280) {
      win.setContentSize(640, 900); await paint(); await paint();
      const resized = await run(`(() => { const nav=document.querySelector('.settings-section-scroller').getBoundingClientRect(), button=document.querySelector('[aria-current=location]'), active=button.getBoundingClientRect();
        const section=document.getElementById(button.getAttribute('aria-controls')).closest('.settings-card,.settings-advanced').getBoundingClientRect(), body=document.querySelector('.settings-body').getBoundingClientRect();
        return {left:active.left,right:active.right,navLeft:nav.left,navRight:nav.right,current:button.dataset.settingsSection,sectionVisible:section.bottom>nav.bottom && section.top<body.bottom}; })()`);
      // Reflow can change the visible section; the marker must follow it and remain visible.
      assert.ok(resized.sectionVisible && resized.left >= resized.navLeft - 1 && resized.right <= resized.navRight + 1, 'resizing reveals the current navigation item after reflow');
      reports[reports.length - 1].resized = resized;
    }
  }
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
