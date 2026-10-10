const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');
const assertToolbar = require('../test/ui/command-bar-layout.cjs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  const press = (keyCode, modifiers = []) => { for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers }); };
  const click = async selector => {
    const point = await run(`(() => {const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'center'});
      const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await paint(); const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({type,
      x:Math.round(point.x*zoom),y:Math.round(point.y*zoom),button:'left',clickCount:1});
  };
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const density of ['compact', 'comfortable']) for (const singlePage of [false, true]) {
      win.webContents.setZoomFactor(1); win.setContentSize(960, 900);
      const label = `${locale}-${theme}-${density}-${singlePage ? 'one' : 'many'}`;
      await win.loadFile(join(output, 'index.html'), { query: { surface:'shell',locale,density,stress:'1',
        ...(singlePage ? {singlePage:'1'} : {}) } });
      await wait('!!document.querySelector("[data-draft-open]")'); await paint();
      await assertToolbar({win,run,output,label});
      await click('textarea[name=prompt]');
      await wait('document.querySelector(".command-bar").classList.contains("is-expanded")'); await paint();
      await assertToolbar({win,run,output,label:label+'-expanded'});
      press('Escape');
      await wait('!document.querySelector(".command-bar").classList.contains("is-expanded")');
      await click('[data-draft-open]'); await wait('!!document.querySelector("[role=dialog]")');
      assert.equal(await run('document.activeElement===document.querySelector(".folder-modal header button")'), true);
      await shot(label+'-draft-dialog'); press('Escape'); await wait('!document.querySelector("[role=dialog]")');
      assert.equal(await run('document.activeElement===document.querySelector("[data-draft-open]")'), true);
      press('Tab'); press('Tab', ['shift']); await paint();
      assert.equal(await run(`(() => {const n=document.querySelector('[data-draft-open]'),s=getComputedStyle(n);
        return document.activeElement===n && n.matches(':focus-visible') && s.outlineStyle!=='none';})()`), true, 'draft entry must expose keyboard focus');
      // 150% shell zoom at a 1440px content width still exercises the supported 960px CSS viewport.
      win.setContentSize(1440, 900); win.webContents.setZoomFactor(1.5); await paint();
      await assertToolbar({win,run,output,label:label+'-zoom150'});
      reports.push(label);
    }
    win.webContents.setZoomFactor(1); win.setContentSize(960, 600);
    await win.loadFile(join(output, 'index.html'), {query:{surface:'drafts',locale,draftStatus:'error'}});
    await wait('!!document.querySelector(".draft-recovery-entry")'); await click('.draft-recovery-entry > summary'); await paint();
    const inline = await run(`(() => {const entry=document.querySelector('.draft-recovery'),token=getComputedStyle(document.documentElement);
      return [...entry.querySelectorAll('button')].map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {
        radius:s.borderRadius,height:r.height,color:s.color,width:n.clientWidth,scroll:n.scrollWidth,
        expectedRadius:token.getPropertyValue('--radius-control').trim(),expectedColor:getComputedStyle(entry).color};});})()`);
    await shot(`${locale}-${theme}-inline-drafts`);
    writeFileSync(join(output, `${locale}-${theme}-inline-metrics.json`), JSON.stringify(inline, null, 2));
    assert.equal(inline.length >= 2, true);
    for (const button of inline) {
      assert.equal(button.radius, button.expectedRadius, 'inline draft actions must reuse the existing control radius');
      assert.equal(button.color, button.expectedColor, 'inline draft actions must use the current theme text color');
      assert.equal(button.height >= 32 && button.scroll <= button.width + 1, true, 'inline draft action must fit its label');
    }
    await win.loadFile(join(output, 'index.html'), {query:{surface:'shell',locale,manyDrafts:'1',singlePage:'1'}});
    await wait('!!document.querySelector("[data-draft-open]")'); await click('[data-draft-open]');
    await wait('!!document.querySelector("[role=dialog]")'); await paint();
    await shot(`${locale}-${theme}-many-drafts`);
    assert.equal(await run(`(() => {const r=document.querySelector('[role=dialog]').getBoundingClientRect();
      return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()`), true, 'draft copies must scroll inside the modal');
    assert.equal(await run(`(() => {const body=document.querySelector('.folder-modal > .draft-recovery');
      return body.scrollHeight>body.clientHeight;})()`), true, 'long draft lists must have an actual scroll range');
    await click('.draft-copy-list > li:last-child button'); await wait('!!document.querySelector(".draft-preview")');
    await click('.draft-actions > button:first-child'); await wait('!!document.querySelector(".draft-confirm")'); await paint();
    const confirmation = await run(`(() => {
      const body=document.querySelector('.folder-modal > .draft-recovery'),r=body.getBoundingClientRect();
      const buttons=[...document.querySelectorAll('.draft-confirm button')].map(n=>{
        const b=n.getBoundingClientRect();return {top:b.top,bottom:b.bottom,visible:b.top>=r.top-1 && b.bottom<=r.bottom+1};});
      const header=document.querySelector('.folder-modal header button').getBoundingClientRect();
      const modal=document.querySelector('.folder-modal').getBoundingClientRect();
      return {buttons,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,scrollTop:body.scrollTop,
        cancelFocused:document.activeElement===document.querySelector('.draft-confirm button'),
        closeVisible:header.top>=modal.top && header.bottom<=r.top};
    })()`);
    await shot(`${locale}-${theme}-many-drafts-confirmation`);
    writeFileSync(join(output, `${locale}-${theme}-many-drafts-confirmation.json`), JSON.stringify(confirmation, null, 2));
    assert.equal(confirmation.cancelFocused && confirmation.closeVisible && confirmation.scrollTop>0, true);
    assert.equal(confirmation.buttons.length===2 && confirmation.buttons.every(button=>button.visible), true, 'last draft restore confirmation must remain visible');
    press('Escape'); await wait('!document.querySelector("[role=dialog]")');
    await win.loadFile(join(output, 'index.html'), {query:{surface:'shell',locale,sending:'1',singlePage:'1'}});
    await wait('!!document.querySelector("[data-draft-open]")'); await paint();
    await assertToolbar({win,run,output,label:`${locale}-${theme}-busy`});
    assert.equal(await run(`(() => {const n=document.querySelector('[data-draft-open]');return n.disabled && Number(getComputedStyle(n).opacity)<1;})()`), true);
    await click('[data-draft-open]'); assert.equal(await run('!!document.querySelector("[role=dialog]")'), false, 'busy entry must ignore pointer activation');
    await win.loadFile(join(output, 'index.html'), {query:{surface:'settings',locale,density:'comfortable'}});
    await wait('!!document.querySelector("#settings-preference-sync-title")');
    await run('document.querySelector("#settings-preference-sync-title").closest("section").scrollIntoView({block:"start"})');
    await paint(); await shot(`${locale}-${theme}-preference-sync`);
    assert.equal(await run(`(() => {const card=document.querySelector('#settings-preference-sync-title').closest('section');
      return card.scrollWidth<=card.clientWidth+1 && card.querySelectorAll('input[type=radio]').length===8
        && !!card.querySelector('input[name=draft-sync]');})()`), true, 'actual preference sync controls must fit their settings card');
  }
  win.webContents.setZoomFactor(1);
  writeFileSync(join(output, 'draft-tools-report.json'), JSON.stringify({reports,failures:[]},null,2));
  console.log(`Draft tools passed: ${reports.length} toolbar variants, expanded/collapsed, 150% zoom, keyboard/disabled states, inline actions and scrollable dialogs.`);
};
