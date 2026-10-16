const assert = require('node:assert/strict');

module.exports = async ({ win, run, wait, click, key, shot, locale, theme, zoom }) => {
  const marked = '.archive-answer-nav a[data-best=true]';
  const layout = () => run(`(() => ({ navigation:document.querySelector('.library-reading-navigation').getBoundingClientRect().height,
    widths:[...document.querySelectorAll('.archive-answer-nav a')].map(link=>link.getBoundingClientRect().width) }))()`);
  const initialLayout = await layout();
  const check = async index => {
    const metrics = await run(`(() => {
      const links = [...document.querySelectorAll('.archive-answer-nav a[data-best=true]')], link = links[0];
      const source = document.querySelector('#archive-answer-${index}'), active = document.activeElement;
      const nav = document.querySelector('.library-reading-navigation').getBoundingClientRect();
      const pane = document.querySelector('.archive-detail-pane').getBoundingClientRect(), box = active.getBoundingClientRect();
      const luminance = color => color.match(/[\\d.]+/g).slice(0,3).map(value => {
        value = Number(value)/255; return value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4;
      }).reduce((sum,value,i) => sum+value*[.2126,.7152,.0722][i],0);
      const style = getComputedStyle(link), colors = [luminance(style.color),luminance(style.backgroundColor)];
      return { count:links.length, href:link.getAttribute('href'), label:link.getAttribute('aria-label'),
        expected:source.querySelector('h2').textContent.split(' · ')[0]+' · '+window.libraryTest.copy.archiveBestAnswer,
        icon:link.querySelector('svg')?.getAttribute('aria-hidden'), current:link.getAttribute('aria-current'),
        contrast:(Math.max(...colors)+.05)/(Math.min(...colors)+.05),
        focused:active === source.querySelector('.archive-answer-actions button'),
        top:box.top, bottom:box.bottom, navBottom:nav.bottom, paneBottom:pane.bottom,
        saved:window.libraryTest.writes };
    })()`);
    assert.equal(metrics.count, 1); assert.equal(metrics.href, `#archive-answer-${index}`);
    assert.equal(metrics.label, metrics.expected); assert.equal(metrics.icon, 'true'); assert.equal(metrics.current, 'location');
    assert.ok(metrics.contrast >= 4.5, `best source remains readable: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.focused && metrics.top >= metrics.navBottom - 1 && metrics.bottom <= metrics.paneBottom + 1,
      `saved marker preserves source action focus: ${JSON.stringify(metrics)}`);
    return metrics;
  };
  const navigate = async index => {
    await click(`.archive-answer-nav a[href="#archive-answer-${index}"]`); await key('Tab');
    assert.equal(await run(`document.activeElement === document.querySelector('#archive-answer-${index} .archive-answer-actions button')`), true);
  };
  win.focus(); win.webContents.focus();
  // 上游锚点用例已通过原生 Tab 聚焦第九份回答的“标为最佳”。
  await key('Return');
  await wait(`!!document.querySelector('${marked}[href="#archive-answer-8"]') && !document.querySelector('#archive-answer-8 button').disabled`);
  const last = await check(8);
  assert.deepEqual(await layout(), initialLayout, 'marking best never reflows the sticky source navigation');
  await navigate(8);
  assert.equal(await run('location.hash'), '#archive-answer-8');
  await navigate(0);
  await wait('document.querySelector(".archive-answer-nav [aria-current=location]")?.getAttribute("href") === "#archive-answer-0"');
  assert.equal(await run(`document.querySelector('${marked}')?.getAttribute('href')`), '#archive-answer-8', 'reading another source does not move best');
  assert.equal(await run(`document.querySelector('${marked}')?.hasAttribute('aria-current')`), false, 'best and location remain independent');
  await key('Return');
  await wait(`!!document.querySelector('${marked}[href="#archive-answer-0"]') && !document.querySelector('#archive-answer-0 button').disabled`);
  const first = await check(0);
  assert.deepEqual(await layout(), initialLayout, 'moving best never reflows the sticky source navigation');
  await shot(`best-source-${locale}-${theme}-${Math.round(zoom * 100)}`);
  if (locale === 'zh-CN') {
    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
        { name:'forced-colors', value:'active' }, { name:'prefers-reduced-motion', value:'reduce' }
      ] });
      assert.equal(await run('matchMedia("(forced-colors: active)").matches && matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
      assert.equal(await run(`(() => { const icon=document.querySelector('${marked} svg'); const s=getComputedStyle(icon);
        return s.display !== 'none' && s.visibility === 'visible' && icon.getBoundingClientRect().width >= 12
          && getComputedStyle(icon.closest('a')).forcedColorAdjust === 'auto'; })()`), true);
      await shot('best-source-forced-colors');
    } finally {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
    }
  }
  await run('window.libraryTest.failSave=true'); await key('Return');
  await wait('document.querySelector(".archive-workspace .archive-status").textContent === window.libraryTest.copy.archiveSaveFailed');
  await check(0);
  await run('window.libraryTest.failSave=false'); await key('Return');
  await wait(`!document.querySelector('${marked}') && !document.querySelector('#archive-answer-0 button').disabled`);
  assert.deepEqual(await layout(), initialLayout, 'clearing best never reflows the sticky source navigation');
  assert.equal(await run('window.libraryTest.writes'), 3, 'mark, move and clear each save once; failure never changes the bookmark');
  return { last, first, failedSave:'retained', cleared:true, writes:3 };
};
