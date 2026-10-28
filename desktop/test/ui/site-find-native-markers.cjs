const assert = require('node:assert/strict');
const fs = require('node:fs'), { join } = require('node:path');
module.exports = async ({ win, run, until, paint, manager, pages, keys, output, locale, report }) => {
  const needle = 'POSITION_NEEDLE', pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  // 前一个视觉用例注入了高 revision 的合成状态；重载外壳恢复真实 IPC 状态。
  await win.loadFile(join(output, 'index.html'));
  await until(() => run('!!document.querySelector(".app-shell")'), 'marker shell reloaded');
  pages = manager.getDiagnosticSites().map(site => ({ key:site.site,
    view:win.contentView.children.find(view => view.webContents?.id === site.webContentsId) }));
  const html = mode => '<meta charset="utf-8"><style>html,body{margin:0;font:18px sans-serif;background:white;color:black}' +
    (mode === 'nested' ? 'html,body{height:100%;overflow:hidden}main{height:100%;overflow:auto}' : '') +
    (mode === 'hidden-root' ? '::-webkit-scrollbar{display:none}' : '') +
    '</style><main><input value="preserved draft">' +
    Array.from({ length:3 }, (_, i) => '<section style="height:1100px;padding:40px;box-sizing:border-box"><p>' + needle + ' ' + i + '</p></section>' +
      (i === 0 ? '<article style="font-size:32px">' + 'wrapping text '.repeat(300) + '</article>' : '')).join('') + '</main>';
  win.setContentSize(1600, 1000); win.webContents.setZoomFactor(1);
  manager.setComposerExpanded(false); manager.setDrawerOpen(false); manager.setLayout('focus', keys[0], false);
  await run('window.polyask.setDisplayPreferences({density:"compact",siteScale:1})');
  const c = pages[0].view.webContents, state = () => manager.siteFind.state.sites.find(s => s.site === keys[0]);
  const ready = () => until(() => state()?.status === 'ready' && state().matches === 3, 'native position count');
  const search = async (query, scope) => {
    manager.siteFind.open();
    await until(() => run('document.activeElement?.name==="site-find-query"'), 'marker query focused');
    await paint();
    await run('document.querySelector("[name=site-find-query]").select()');
    await win.webContents.insertText(query);
    await run('(()=>{const e=document.querySelector("[name=site-find-scope]");e.value=' + JSON.stringify(scope) + ';e.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await until(() => manager.siteFind.state.query === query && manager.siteFind.state.scope === scope &&
      manager.siteFind.state.sites.every(s => s.status !== 'pending'), 'marker query settled');
  };
  for (const mode of ['root', 'nested', 'hidden-root']) {
    await c.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html(mode)));
    await search(needle, 'current'); await ready();
    if (mode === 'root') {
      await pause(400);
      assert.equal(state().positions, undefined, 'visible root scrollbar keeps Chromium ticks only');
      continue;
    }
    await until(() => state()?.positions?.length === 3, mode + ' positions');
    for (const zoom of [1, 1.5, 2]) {
      win.webContents.setZoomFactor(zoom); manager.relayout();
      await until(() => run('document.querySelectorAll("[data-find-markers] i").length===3'), 'shell ticks rendered');
      await paint(); await pause(250);
      const track = await run('(()=>{const e=document.querySelector(".site-find-marker-track"),r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');
      const bounds = pages[0].view.getBounds();
      assert.equal(Math.abs(track.x * zoom - bounds.x - bounds.width) <= 2, true, 'rail touches native view edge');
      assert.equal(Math.abs(track.y * zoom - bounds.y) <= 2, true, 'rail starts below tile header');
      assert.equal(Math.abs(track.height * zoom - bounds.height) <= 2, true, 'track matches native viewport height');
      const screenshot = await win.capturePage(), bitmap = screenshot.toBitmap(), size = screenshot.getSize();
      const x = Math.round((track.x + track.width / 2) * zoom), rows = [];
      for (let y = Math.ceil(track.y * zoom); y < Math.min(size.height, (track.y + track.height) * zoom); y++) {
        const i = (y * size.width + x) * 4;
        if (bitmap[i + 2] > 180 && bitmap[i + 1] > 90 && bitmap[i + 1] < 210 && bitmap[i] < 100) rows.push(y);
      }
      assert.equal(rows.length >= 3, true, 'orange ticks are actually visible beside native contents');
      fs.writeFileSync(join(output, locale + '-markers-' + mode + '-' + zoom + '.png'), screenshot.toPNG());
      report.layouts.push({ markers:mode, zoom, track, native:bounds, orangeRows:rows.length });
      const before = await c.executeJavaScript('({html:document.body.innerHTML,top:(document.querySelector("main").scrollTop||scrollY),selection:getSelection().toString(),input:document.querySelector("input").value})');
      manager.siteFind.sync(); await pause(450);
      const after = await c.executeJavaScript('({html:document.body.innerHTML,top:(document.querySelector("main").scrollTop||scrollY),selection:getSelection().toString(),input:document.querySelector("input").value})');
      assert.deepEqual(after, before, 'position refresh is read-only');
    }
    if (mode === 'nested') {
      win.webContents.setZoomFactor(1); manager.relayout(); await pause(450);
      const previous = JSON.stringify(state().positions);
      while (c.getZoomFactor() < 2) manager.siteZoom.step(keys[0], 'in');
      await until(() => JSON.stringify(state().positions) !== previous, 'manual site zoom refreshes positions');
      const expected = await c.executeJavaScript('(()=>{const e=document.querySelector("main");return[...e.querySelectorAll("section p")].map(p=>{const r=document.createRange();r.selectNodeContents(p);return(r.getBoundingClientRect().top-e.getBoundingClientRect().top+e.scrollTop)/e.scrollHeight})})()');
      assert.equal(expected.every((n, i) => Math.abs(n - state().positions[i]) < 0.003), true, 'zoomed positions match real content');
      manager.siteZoom.step(keys[0], 'reset');
    }
  }
  win.webContents.setZoomFactor(1); manager.setLayout('overview', keys[0], false);
  for (const page of pages) await page.view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html('nested')));
  await search(needle, 'all');
  await until(() => manager.siteFind.state.sites.every(s => s.positions?.length === 3), 'all nine summaries');
  for (const page of [0,1,2]) {
    manager.setPage(page);
    await until(() => run('document.querySelectorAll("[data-find-markers]").length===3'), 'current page rails');
    const visible = await run('[...document.querySelectorAll("[data-find-markers]")].map(e=>e.dataset.findMarkers)');
    assert.deepEqual(visible, manager.getLayout().placements.map(p => p.key));
    const first = pages.find(p => p.key === visible[0]).view.getBounds();
    for (const hidden of pages.filter(p => !visible.includes(p.key))) assert.deepEqual(hidden.view.getBounds(), first, 'background view cannot leak into reserved rail');
  }
  await search('absent value', 'all');
  await until(() => run('document.querySelectorAll("[data-find-markers]").length===0'), 'changed query removes markers');
  manager.siteFind.close(false);
  assert.equal(manager.siteFind.state.sites.length, 0);
  await until(() => run('!document.querySelector(".site-find-markers")'), 'closed marker overlay removed');
  report.cases.push('markers: native root fallback, nested/hidden root, 100/150/200% geometry and visible pixels, read-only refresh, nine-page coverage and cleanup');
};
