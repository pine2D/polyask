const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeTheme } = require('electron');
const { nativeReadingTools } = require('../test/ui/comparison-native-tools.cjs');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const reports = [];
  const native = nativeReadingTools(win, output, { scenario: 'shortcut-search', step: 'filter' }, run);
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const platform of ['win32', 'darwin']) {
    for (const width of [960, 1280, 1400, 1440, 480]) {
      win.webContents.setZoomFactor(1); win.setContentSize(width, 800);
      await win.loadFile(join(output, 'index.html'), { query: { surface: 'shortcuts', locale, platform } });
      await wait('!!document.querySelector(".command-results kbd")'); await paint();
      const result = await run(`(() => {
        const keys=[...document.querySelectorAll('.command-results kbd')].filter(e=>e.textContent.trim());
        const visible=keys.filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
        const subtitle=document.querySelector('.command-subtitle'),list=document.querySelector('.command-results');
        return {subtitleClipped:subtitle.scrollHeight>subtitle.clientHeight+1,subtitleBottom:subtitle.getBoundingClientRect().bottom,listTop:list.getBoundingClientRect().top,
          total:keys.length,visible:visible.length,overflow:[...document.querySelectorAll('.command-results > button')]
          .some(e=>e.scrollWidth>e.clientWidth+1),names:visible.map(e=>e.textContent)};
      })()`);
      assert.equal(result.total > 0, true);
      if (result.subtitleClipped || result.subtitleBottom > result.listTop + 1) await shot('shortcut-search-layout-failure');
      assert.equal(result.subtitleClipped, false, 'shortcut explanations retain their full height');
      assert.equal(result.subtitleBottom <= result.listTop + 1, true, 'shortcut explanations and the scrollable result list do not overlap');
      assert.equal(result.visible, result.total, `${locale}/${platform}/${width}: shortcut reference must expose every key`);
      assert.equal(result.overflow, false, `${locale}/${platform}/${width}: shortcut rows fit`);
      reports.push({ locale, platform, width, ...result });
      if (locale === 'en' && platform === 'win32' && width === 1280) await shot('shortcuts-1280');
    }
  }
  const searches = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const platform of ['win32', 'darwin']) {
    const theme = platform === 'darwin' ? 'dark' : 'light'; nativeTheme.themeSource = theme;
    win.webContents.setZoomFactor(1); win.setContentSize(960, 680);
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'shortcuts', locale, platform } });
    await wait('document.activeElement===document.querySelector(".command-search input")');
    const sample = await run(`(() => {const first=document.querySelector('#command-results [role=option]');
      return {label:first.querySelector('strong').textContent,category:first.querySelector('small').textContent,key:first.querySelector('kbd').textContent.split(' · ')[0],total:document.querySelectorAll('#command-results [role=option]').length};})()`);
    const search = '.command-search input';
    const sendLabels = { en: 'Send prompt (in prompt field)', 'zh-CN': '发送提问（提问框内）', 'zh-TW': '傳送提問（提問框內）' };
    const sendKey = platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter';
    for (const query of ['发送', 'send', 'Enter', '↵', 'Ctrl+↵', sendKey]) {
      await native.type(search, query);
      const result = await run(`(() => {const rows=[...document.querySelectorAll('#command-results [role=option]')];
        const send=rows.filter(row=>row.querySelector('strong')?.textContent===${JSON.stringify(sendLabels[locale])});
        return {count:rows.length,matches:send.length,key:send[0]?.querySelector('kbd')?.textContent};})()`);
      assert.equal(result.matches, 1, `${locale}/${platform}: send reference is present for ${query}`);
      assert.equal(result.key, sendKey);
      if (['Ctrl+↵', sendKey].includes(query)) assert.equal(result.count, 1, `${locale}/${platform}: explicit send key is unique`);
      if (locale === 'en' && query === 'send') assert.equal(result.count > 1, true, 'send also matches the Compose and send category');
    }
    await native.click('#command-results [role=option]');
    await native.key('Return');
    assert.equal(await run('document.body.dataset.executed??null'), null, 'send reference is read-only');
    assert.equal(await run('!!document.querySelector(".command-search input")'), true);
    win.setContentSize(1280, 900); win.webContents.setZoomFactor(2);
    await wait('Math.abs(innerWidth-640)<=1'); await paint();
    const sendZoom = await run(`(() => {const row=document.querySelector('#command-results [role=option]'), title=row.querySelector('strong'), key=row.querySelector('kbd');
      const r=row.getBoundingClientRect(), t=title.getBoundingClientRect(), k=key.getBoundingClientRect();
      return {overflow:row.scrollWidth>row.clientWidth+1,titleClipped:title.scrollWidth>title.clientWidth+1,
        within:r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,separate:t.right<=k.left};})()`);
    assert.equal(!sendZoom.overflow && !sendZoom.titleClipped && sendZoom.within && sendZoom.separate, true,
      `${locale}/${platform}: send context and keys remain readable at 200%: ${JSON.stringify(sendZoom)}`);
    await shot(`shortcut-send-${locale}-${platform}-zoom200`);
    win.webContents.setZoomFactor(1); win.setContentSize(960, 680);
    await wait('innerWidth===960'); await paint();
    await native.type(search, sample.category);
    assert.equal(await run("document.querySelectorAll('#command-results [role=option]').length>1"), true, 'category search preserves multiple shortcut references');
    assert.equal(await run(`[...document.querySelectorAll('#command-results [role=option]')].every(node=>node.querySelector('small').textContent===${JSON.stringify(sample.category)})`), true);
    await native.type(search, sample.key);
    assert.equal(await run(`document.querySelector('#command-results [role=option] strong')?.textContent===${JSON.stringify(sample.label)}`), true);
    await native.key('ArrowDown');
    assert.equal(await run('document.getElementById(document.querySelector(".command-search input").getAttribute("aria-activedescendant"))?.getAttribute("aria-selected")==="true"'), true);
    await native.type(search, 'no such shortcut'); await wait('!!document.querySelector(".command-empty")');
    await native.key('Enter'); assert.equal(await run('document.body.dataset.executed??null'), null);
    await native.type(search, sample.label);
    await native.click('#command-tab-commands'); await wait('document.querySelector("#command-tab-commands").getAttribute("aria-selected")==="true"');
    assert.equal(await run('document.querySelector(".command-search input").value'), '');
    await native.type(search, 'drive'); await native.click('#command-tab-shortcuts');
    await wait(`document.querySelector('.command-search input')?.value===${JSON.stringify(sample.label)}`);
    const geometry = await run(`(() => {const panel=document.querySelector('.command-palette').getBoundingClientRect(), input=document.querySelector('.command-search input').getBoundingClientRect();
      return {bottom:panel.bottom,height:innerHeight,inputRight:input.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
    assert.equal(geometry.bottom <= geometry.height + 1 && geometry.inputRight <= geometry.width + 1 && !geometry.overflow, true);
    await shot(`shortcut-search-${locale}-${platform}`);
    searches.push({ locale, platform, theme, geometry, sample, sendZoom });
  }
  await run('document.querySelector("#command-tab-commands").focus()');
  for (const type of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Enter' });
  await wait('document.querySelector("#command-tab-commands").getAttribute("aria-selected")==="true" && !!document.querySelector(".command-search input")');
  await native.type('.command-search input', '');
  const visible = await run(`[...document.querySelectorAll('.command-results kbd')].filter(e=>e.textContent.trim()).every(e=>e.getClientRects().length>0)`);
  assert.equal(visible, true, 'command search also keeps its shortcut hints');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Enter' });
  await wait('!!document.body.dataset.executed');
  writeFileSync(join(output, 'shortcut-reference.json'), JSON.stringify(reports, null, 2));
  writeFileSync(join(output, 'shortcut-search.json'), JSON.stringify(searches, null, 2));
  console.log(`Shortcut reference passed: ${reports.length} locale/platform/width scenarios.`);
  console.log(`Shortcut search passed: ${searches.length} native locale/platform groups.`);
};
