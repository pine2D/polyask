const { nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { processBoundary } = require('./native-process-boundary.cjs');

module.exports = async ({ app, win, state, output, js, check, until, click, key, geometry }) => {
  const boundary = processBoundary(app, output), layouts = [], controls = [];
  const cases = ['zh-CN', 'zh-TW', 'en'].flatMap(locale => ['light', 'dark'].flatMap(theme => [
    { locale, theme, density: 'compact', width: 960, height: 720, zoom: 1 },
    { locale, theme, density: 'comfortable', width: 960, height: 720, zoom: 1 },
    { locale, theme, density: 'comfortable', width: 1280, height: 960, zoom: 2 }
  ]));
  boundary();
  for (const sample of cases) {
    const { locale, theme, density, width, height, zoom } = sample;
    const name = `${locale}-${theme}-${density}-${zoom}`;
    state.scenario = name; state.step = 'load';
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(width, height);
    await win.loadFile(join(output, 'index.html'), { query: { locale, mode: 'comparison' } });
    win.webContents.setZoomFactor(zoom);
    await until('document.querySelectorAll(".archive-compare-column").length===2', 'comparison');
    await js(`document.documentElement.dataset.density=${JSON.stringify(density)}`);
    await js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    if (await js('document.querySelector(".folder-workspace").dataset.focused!=="true"')) await click('.comparison-focus');
    await until('document.querySelector(".folder-workspace").dataset.focused==="true"', 'focused reading');
    const measure = await js(`(() => {
      const toolbar=document.querySelector('.folder-toolbar'),pane=document.querySelector('.archive-detail-pane'),column=document.querySelector('.archive-compare-column');
      const rect=toolbar.getBoundingClientRect(),p=pane.getBoundingClientRect(),c=column.getBoundingClientRect();
      const buttons=[...toolbar.querySelectorAll('button')].filter(node=>node.getClientRects().length);
      return {toolbarHeight:rect.height,paneTop:p.top,toolbarBottom:rect.bottom,columnTop:c.top,columnHeight:c.height,
        merged:document.querySelector('.archive-workspace').dataset.toolbarMerged==='true',innerToolbar:!!document.querySelector('.archive-toolbar'),
        organized:!!toolbar.querySelector('.library-organize'),menuCount:document.querySelectorAll('.archive-actions .library-menu-trigger').length,
        controlsFit:buttons.every(node=>{const r=node.getBoundingClientRect();return r.width>=32&&r.height>=32&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=rect.bottom+1}),
        overlap:buttons.some((node,i)=>buttons.slice(i+1).some(other=>{const a=node.getBoundingClientRect(),b=other.getBoundingClientRect();return Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1}))};
    })()`);
    check(measure.merged && !measure.innerToolbar && measure.organized && measure.menuCount === 1, `${name}: one merged record toolbar`);
    check(Math.abs(measure.paneTop - measure.toolbarBottom) <= 1, `${name}: no empty management row`);
    check(measure.controlsFit && !measure.overlap, `${name}: toolbar controls are visible and distinct`);
    if (zoom === 1) check(measure.toolbarHeight <= 60 && measure.columnTop < 360 && measure.columnHeight >= 350,
      `${name}: short window recovers a toolbar row for reading`);
    layouts.push({ ...await geometry(name), ...measure });
    writeFileSync(join(output, 'geometry.json'), JSON.stringify(layouts, null, 2));
    writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    boundary();
    if (theme !== 'light' || density !== 'compact') continue;
    state.step = 'keyboard-menu';
    await js('document.querySelector(".folder-toolbar .library-organize").focus()');
    await key('Tab');
    check(await js('document.activeElement===document.querySelector(".folder-toolbar [data-action=archive-markdown-export]")'), `${name}: Markdown has a visible keyboard entry`);
    await key('Tab');
    check(await js('document.activeElement===document.querySelector(".folder-toolbar .library-menu-trigger")'), `${name}: visual and Tab order agree`);
    await key('Down'); await until('!!document.querySelector("[role=menu]")', 'record menu');
    check(await js(`(() => {
      const copy=window.readingFixture.labels, labels=[...document.querySelectorAll('[role=menuitem]')].map(node=>node.textContent);
      return labels.length===4&&[copy.copyArchive,copy.reportExportHtml,copy.reportExportPdf,copy.deleteArchive].every(label=>labels.includes(label));
    })()`), 'copy, all three export formats and delete remain available');
    await key('Escape');
    check(await js('!document.querySelector("[role=menu]")&&document.activeElement===document.querySelector(".folder-toolbar .library-menu-trigger")'), 'Escape returns to the merged trigger');
    state.step = 'reading-return';
    await js(`(()=>{window.layoutColumns=[...document.querySelectorAll('.archive-compare-column')];
      window.layoutColumns.forEach((node,index)=>{node.scrollTop=140+index*80;node.dispatchEvent(new Event('scroll'))});})()`);
    await click('.comparison-focus'); await click('.comparison-focus');
    check(await js(`[...document.querySelectorAll('.archive-compare-column')].every((node,index)=>node===window.layoutColumns[index]&&Math.abs(node.scrollTop-(140+index*80))<=1)`), 'focused/browse return preserves both reading nodes and positions');
    check(await js('document.activeElement===document.querySelector(".comparison-focus")'), 'return retains the comparison action focus');
    controls.push({ name, ok: true });
  }
  boundary();
  const report = [{ scenario: 'focused-toolbar-layout', ok: true }, { scenario: 'focused-toolbar-keyboard-and-return', ok: controls.length === 3 }];
  writeFileSync(join(output, 'report.json'), JSON.stringify({ report, geometry: layouts, controls }, null, 2));
  console.log(JSON.stringify({ report, layouts: layouts.length, controls: controls.length }));
};
