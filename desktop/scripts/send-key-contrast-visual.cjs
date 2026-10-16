const assert = require('node:assert/strict');
const { nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, output, run, wait, paint }) => {
  const reports = [];
  const previousTheme = nativeTheme.themeSource;
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    win.webContents.setZoomFactor(1); win.setContentSize(1600, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale: 'zh-CN' } });
    await wait('!!document.querySelector(".send:not(:disabled)")'); await paint();
    const { x, y } = await run('(()=>{const r=document.querySelector(".send").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
    for (const state of ['normal', 'hover', 'focus']) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: state === 'hover' ? Math.round(x) : 1, y: state === 'hover' ? Math.round(y) : 400 });
      await run(state === 'focus' ? 'document.querySelector(".send").focus()' : 'document.activeElement.blur()');
      await paint();
      const result = await run(`(() => {
        const button=document.querySelector('.send'),e=button.querySelector('kbd'),s=getComputedStyle(e),b=getComputedStyle(button);
        const visible=e.getClientRects().length>0&&!button.disabled;
        const parse=c=>c.match(/[\\d.]+/g).slice(0,3).map(Number),bg=parse(b.backgroundColor),fg=parse(s.color);
        const opacity=Number(s.opacity),brightness=Number(b.filter.match(/brightness\\(([\\d.]+)\\)/)?.[1]??1);
        const background=bg.map(v=>v*brightness),foreground=fg.map((v,i)=>(v*opacity+bg[i]*(1-opacity))*brightness);
        const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const a=luminance(foreground),z=luminance(background);
        return {visible,opacity,foreground,background,ratio:(Math.max(a,z)+.05)/(Math.min(a,z)+.05)};
      })()`);
      assert.equal(result.visible, true, 'enabled shortcut sample must be visible');
      assert.equal(result.ratio >= 4.5, true, `${theme}/${state}: shortcut contrast ${result.ratio.toFixed(2)}`);
      reports.push({ theme, state, ...result });
    }
  }
  nativeTheme.themeSource = previousTheme;
  writeFileSync(join(output, 'send-key-contrast.json'), JSON.stringify(reports, null, 2));
  console.log(`Send key contrast passed: ${reports.length} theme/state scenarios.`);
};
