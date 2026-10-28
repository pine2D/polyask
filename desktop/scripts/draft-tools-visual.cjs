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
  const category = async value => {
    await click(`[data-settings-section=${value}]`);
    await wait(`document.querySelector('[data-settings-category]:not([hidden])')?.dataset.settingsCategory===${JSON.stringify(value)}`);
    await paint();
    assert.equal(await run(`document.querySelector('[data-settings-section=${value}]').getAttribute('aria-current')`), 'location');
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
      const focus = await run(`(() => {const n=document.querySelector('[data-draft-open]'),s=getComputedStyle(n),a=document.activeElement;
        return {active:a===n,visible:n.matches(':focus-visible'),outline:s.outlineStyle,target:a.className,fit:document.querySelector('.command-bar').dataset.fit};})()`);
      assert.equal(focus.active && focus.visible && focus.outline !== 'none', true, `draft entry must expose keyboard focus: ${JSON.stringify({label,...focus})}`);
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
    await category('sync');
    await run('document.querySelector("#settings-preference-sync-title").closest("section").scrollIntoView({block:"start"})');
    await paint(); await shot(`${locale}-${theme}-preference-sync`);
    // 同步页仅有 display/layout/siteZoom 三组跟随选择；默认布局编辑唯一位于外观页。
    // 代理行有自己的一组 2 个（ProxySyncRow，走 proxy-follow）。
    assert.equal(await run(`(() => {const card=document.querySelector('#settings-preference-sync-title').closest('section');
      const radios=[...card.querySelectorAll('input[type=radio]')],proxy=radios.filter(n=>n.name==='settings-follow-proxy');
      return card.getClientRects().length>0 && card.scrollWidth<=card.clientWidth+1 && radios.length-proxy.length===6 && proxy.length===2
        && ['display','layout','siteZoom'].every(group=>card.querySelectorAll('input[name=settings-follow-'+group+']').length===2)
        && card.querySelectorAll('input[name=settings-layout-mode]').length===0 && !!card.querySelector('input[name=draft-sync]');})()`), true,
      'visible sync card contains three follow groups, proxy follow and draft sync, with no duplicate layout editor');
    await run('document.querySelector("input[name=settings-follow-proxy]").scrollIntoView({block:"center"})');
    await paint(); await shot(`${locale}-${theme}-proxy-sync-row`);
    await click('[data-preference-group=layout] .settings-inline-action');
    await wait('document.querySelector("[data-settings-category]:not([hidden])")?.dataset.settingsCategory==="appearance" && document.activeElement.id==="settings-layout-title"');
    await paint();
    assert.equal(await run(`(() => {const card=document.querySelector('#settings-layout-title').closest('section');
      const radios=[...document.querySelectorAll('input[name=settings-layout-mode]')];
      return radios.length===2 && radios.every(node=>node.closest('[data-settings-category]')?.dataset.settingsCategory==='appearance')
        && radios.map(node=>node.value).sort().join(',')==='focus,overview' && card.getClientRects().length>0
        && card.scrollWidth<=card.clientWidth+1
        && document.querySelector('[data-preference-group=layout] [data-preference-current]').textContent
          ===document.querySelector('input[name=settings-layout-mode]:checked+span').textContent;})()`), true,
      'layout summary links to the unique visible appearance editor and reflects the accepted value');
    await shot(`${locale}-${theme}-layout-editor`);
    await category('network');
    // 状态未到时 settings-proxy.tsx 先渲染同 id 的骨架卡；等三个模式单选出现再截图和量尺寸。
    await wait('document.querySelectorAll("input[name=settings-proxy-mode]").length===3');
    await run('document.querySelector("#settings-proxy-title").closest("section").scrollIntoView({block:"start"})');
    await paint(); await shot(`${locale}-${theme}-proxy-card`);
    assert.equal(await run(`(() => {const card=document.querySelector('#settings-proxy-title').closest('section');
      return card.scrollWidth<=card.clientWidth+1;})()`), true, 'the network proxy card must fit the settings page');
  }
  win.webContents.setZoomFactor(1);
  writeFileSync(join(output, 'draft-tools-report.json'), JSON.stringify({reports,failures:[]},null,2));
  console.log(`Draft tools passed: ${reports.length} toolbar variants, expanded/collapsed, 150% zoom, keyboard/disabled states, inline actions and scrollable dialogs.`);
};
