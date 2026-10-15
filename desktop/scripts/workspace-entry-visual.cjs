const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');

// Real Chromium accessibility names, responsive entry points, and reserved footer geometry.
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
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
      assert.equal(await run('getComputedStyle(document.querySelector(".mode-switch .priority-p1")).display'), 'none');
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      for (let index = 0; index < 2; index++) {
        const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `.mode-switch button:nth-child(${index + 1})` });
        const { nodes } = await win.webContents.debugger.sendCommand('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        assert.equal(nodes[0].role.value, 'button');
        assert.equal(nodes[0].name.value, names[locale][index], `${locale}/${density}: name survives hidden text and automatic-focus hint`);
      }
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
      assert.ok(commands.includes('open-archive') && commands.includes('collect-compare'), 'folded actions have named command-menu fallbacks');
      reports.push({ locale, density, names: names[locale], geometry, commands });
      if (locale === 'zh-CN') await shot(`workspace-next-step-${density}`);
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
    writeFileSync(join(output, 'workspace-entry-report.json'), JSON.stringify({ reports, namedLibraryEntry: true, unavailableGuidanceHidden: true }, null, 2));
  } finally { win.webContents.debugger.detach(); }
};
