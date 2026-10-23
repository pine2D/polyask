const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');
const assertToolbar = require('../test/ui/command-bar-layout.cjs');

// Real Chromium accessibility names, responsive entry points, and reserved footer geometry.
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  const contentLayouts = [];
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const density of ['compact', 'comfortable']) {
    nativeTheme.themeSource = density === 'compact' ? 'light' : 'dark';
    for (const singlePage of [true, false]) {
      win.webContents.setZoomFactor(1);
      await win.loadFile(join(output, 'index.html'), { query: { locale, density, ...(singlePage ? { singlePage: '1' } : {}) } });
      await wait('!!document.querySelector(".command-bar")');
      for (const width of [960, 1120, 1280, 1600, 1920]) for (const zoom of [1, 1.5, 2]) {
        win.setContentSize(width, 900); win.webContents.setZoomFactor(zoom); await paint();
        const label = `content-${locale}-${density}-${singlePage ? 'one' : 'many'}-${width}-${zoom}`;
        await assertToolbar({ win, run, output, label });
        contentLayouts.push(label);
        if (locale === 'zh-CN' && singlePage && width === 1920 && zoom === 1.5) await shot(label);
      }
    }
  }
  win.webContents.setZoomFactor(1);
  const click = async selector => {
    const point = await run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await paint();
  };
  const names = { en: ['Overview', 'Focus'], 'zh-CN': ['总览', '聚焦'], 'zh-TW': ['總覽', '聚焦'] };
  win.webContents.debugger.attach('1.3');
  try {
    for (const locale of Object.keys(names)) for (const density of ['compact', 'comfortable']) {
      nativeTheme.themeSource = density === 'compact' ? 'light' : 'dark';
      win.setContentSize(960, 900);
      await win.loadFile(join(output, 'index.html'), { query: { locale, density, stress: '1', automaticFocus: '1', progress: '1' } });
      await wait('!!document.querySelector(".feedback-next-step")'); await paint();
      assert.equal(await run(`['.archive-label', '.send > span:first-of-type'].every(selector => {
        const e=document.querySelector(selector); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
      })`), true, `${locale}/${density}: primary actions keep visible text at minimum width`);
      assert.equal(await run('getComputedStyle(document.querySelector(".mode-switch .priority-p1")).display'), 'none');
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      const compactLayout = await run('getComputedStyle(document.querySelector(".layout-toggle")).display !== "none"');
      for (const index of compactLayout ? [0] : [0, 1]) {
        const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: compactLayout ? '.layout-toggle' : `.mode-switch button:nth-child(${index + 1})` });
        const { nodes } = await win.webContents.debugger.sendCommand('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        assert.equal(nodes[0].role.value, 'button');
        assert.equal(nodes[0].name.value, names[locale][compactLayout ? 1 : index], `${locale}/${density}: name survives hidden text and automatic-focus hint`);
      }
      const entry = await run(`(() => { const e=document.querySelector('.archive-trigger'), r=e.getBoundingClientRect();
        return {visible:e.getClientRects().length>0,width:r.width,height:r.height,left:r.left,right:r.right,
          name:e.getAttribute('aria-label'),hint:e.dataset.hint,target:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-size')),
          prompt:document.querySelector('.prompt-composer').getBoundingClientRect().width}; })()`);
      assert.equal(entry.visible && entry.width >= entry.target && entry.height >= entry.target, true,
        `${locale}/${density}: library stays visible at minimum desktop width: ${JSON.stringify(entry)}`);
      assert.equal(entry.left >= 0 && entry.right <= 960 && entry.prompt >= 320, true,
        `library and prompt retain their space: ${JSON.stringify({locale,density,...entry})}`);
      assert.equal(!!entry.name && entry.name === entry.hint, true, 'icon entry retains its localized name and hint');
      if (compactLayout) {
        await run('document.querySelector(".layout-toggle").focus()');
        win.setContentSize(968, 900); await paint();
        assert.equal(await run('document.activeElement === document.querySelector(".layout-toggle")'), true, 'refitting retains keyboard focus on the visible layout action');
        win.setContentSize(960, 900); await paint();
        await click('.layout-toggle');
        assert.equal(await run('document.querySelector(".layout-toggle").getAttribute("aria-label")'), names[locale][0], 'compact layout action switches to focus');
        await click('.layout-toggle');
        assert.equal(await run('document.querySelector(".layout-toggle").getAttribute("aria-label")'), names[locale][1], 'compact layout action returns to overview');
      }
      await run('document.querySelector(".archive-trigger").focus()');
      for (const type of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Return' });
      await wait('document.body.dataset.archiveOpened === "true"');
      const geometry = await run(`(() => { const bar=document.querySelector('.feedback-bar'), next=bar.querySelector('.feedback-next-step'), progress=bar.querySelector('.run-progress');
        const r=next.getBoundingClientRect(), notice=bar.querySelector('.feedback-notice'); return {width:bar.clientWidth,scroll:bar.scrollWidth,left:r.left,right:r.right,progressRight:progress.getBoundingClientRect().right,height:bar.getBoundingClientRect().height,notice:notice.textContent,noticeWidth:notice.clientWidth}; })()`);
      assert.equal(geometry.height, 32);
      assert.ok(geometry.scroll <= geometry.width + 2 && geometry.right <= 960 && geometry.left >= geometry.progressRight, `${locale}/${density}: guidance and progress fit the footer`);
      assert.ok(geometry.notice.length > 0 && geometry.noticeWidth >= 120, 'persistent submission summary stays visible alongside progress and the next step');
      assert.equal(await run('document.querySelector("[name=read-run-copies]").disabled'), false, 'ready copies and collection remain separate available actions');
      assert.equal(await run('document.body.dataset.compared ?? ""'), '');
      await click('.feedback-next-step');
      assert.equal(await run('document.body.dataset.compared'), 'true');
      await click('.more-trigger');
      const commands = await run('(document.body.dataset.menuCommands ?? "").split(",")');
      assert.ok(commands.includes('open-question-history') && commands.includes('collect-compare'), 'folded history and comparison remain reachable');
      assert.equal(commands.includes('open-archive'), false, 'persistent library entry is not duplicated in More');
      reports.push({ locale, density, names: names[locale], entry, geometry, commands });
      if (locale === 'zh-CN') await shot(`workspace-next-step-${density}`);
      for (const state of ['sending', 'cancelling']) {
        await win.loadFile(join(output, 'index.html'), { query: {locale,density,stress:'1',[state]:'1'} });
        await wait('!!document.querySelector(".cancel")'); await paint();
        const action = await run(`(() => { const p=document.querySelector('.prompt-composer'),a=document.querySelector('.cancel');
          return {prompt:p.getBoundingClientRect().width,label:a.textContent,width:a.getBoundingClientRect().width}; })()`);
        assert.ok(action.prompt >= 320, `${locale}/${density}/${state}: ${JSON.stringify(action)}`);
      }
    }
    win.setContentSize(1600, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale: 'zh-CN' } });
    await wait('!!document.querySelector(".archive-label")'); await paint();
    assert.equal(await run('document.querySelector(".archive-label").textContent'), '结果库');
    assert.equal(await run('getComputedStyle(document.querySelector(".archive-label")).display !== "none"'), true);
    await click('.archive-trigger'); assert.equal(await run('document.body.dataset.archiveOpened'), 'true');
    await shot('workspace-library-entry');
    for (const state of ['sending', 'blocked']) {
      await win.loadFile(join(output, 'index.html'), { query: { [state]: '1' } });
      await wait('!!document.querySelector(".command-bar")'); await paint();
      assert.equal(await run('!!document.querySelector(".feedback-next-step")'), false, `${state}: no unavailable guidance`);
    }
    writeFileSync(join(output, 'workspace-entry-report.json'), JSON.stringify({ reports, contentLayouts, namedLibraryEntry: true, unavailableGuidanceHidden: true }, null, 2));
  } finally { win.webContents.debugger.detach(); }
};
