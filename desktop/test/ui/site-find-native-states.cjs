const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
module.exports = async ({ win, run, until, paint, manager, keys, needle, SITE_FIND_HEIGHT, report, output, locale }) => {
  win.setContentSize(1440, 1000); win.webContents.setZoomFactor(1); manager.relayout();
  await until(() => run('innerWidth===1440'), 'native resize delivered before measuring three-site chips');
  manager.setSelection(keys.slice(0, 3)); manager.siteFind.find({ query: needle, scope: 'all' });
  await until(() => manager.siteFind.state.sites.length === 3 && manager.siteFind.state.sites.every(site => site.status !== 'pending'), 'three-site search');
  await paint();
  assert.equal(await run('document.querySelectorAll("[data-find-site]").length'), 3);
  assert.equal(await run('document.querySelector(".site-find-sites").getBoundingClientRect().width>0'), true);
  assert.equal(await run('document.querySelector(".site-find input").getBoundingClientRect().width'), 250);
  for (const cssWidth of [480,720,960,1440]) {
    win.webContents.setZoomFactor(2); win.setContentSize(cssWidth * 2, 1000); manager.relayout();
    await until(() => run(`innerWidth===${cssWidth}`), 'native resize delivered at 200%'); await paint();
    const value = await run(`(()=>{const e=document.querySelector('.site-find'),r=e.getBoundingClientRect();return {width:innerWidth,height:r.height,bottom:r.bottom,
      input:e.querySelector('input').getBoundingClientRect().width,overflow:e.scrollWidth>e.clientWidth}})()`);
    assert.equal(value.width, cssWidth); assert.equal(value.height, 48); assert.equal(value.overflow, false);
    assert.equal(value.input <= 320, true); if (cssWidth >= 720) assert.equal(value.input >= 240, true);
    await until(() => manager.getLayout().placements.every(p => p.bounds.y >= value.bottom - 1), 'native views receive resized toolbar geometry');
    report.layouts.push({ sites: 3, zoom: 2, ...value });
  }
  win.webContents.setZoomFactor(1); manager.setSelection(keys);
  const base = manager.siteFind.state;
  for (const width of [480,720,960,1440]) for (const status of ['ready','pending','unavailable']) {
    win.setContentSize(width, 900); manager.relayout();
    await until(() => run(`innerWidth===${width}`), 'native resize delivered before measuring status');
    const value = { ...base, open: true, session: base.session + 1000 + report.layouts.length,
      revision: base.revision + 1000 + report.layouts.length, query: 'x'.repeat(512),
      sites: keys.map(site => ({ site, matches: 0, active: 0, status })) };
    win.webContents.send('polyask:find-state', value); await paint();
    const geometry = await run(`(()=>{const bar=document.querySelector('.site-find'),b=bar.getBoundingClientRect(),e=bar.querySelector('input');
      const rects=[...bar.querySelectorAll('input,select,button,[data-find-position]')].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
      return {width:innerWidth,height:b.height,bottom:b.bottom,input:e.getBoundingClientRect().width,length:e.value.length,
        overflow:rects.some(r=>r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1),
        summary:bar.querySelector('[data-find-position]').textContent,close:bar.querySelector('[name=site-find-close]').getBoundingClientRect().width}})()`);
    assert.equal(geometry.width, width); assert.equal(geometry.height, SITE_FIND_HEIGHT); assert.equal(geometry.overflow, false);
    assert.equal(geometry.length, 512); assert.equal(geometry.close >= 24, true);
    assert.equal(geometry.input <= 320, true); assert.equal(!!geometry.summary, true);
    await until(() => manager.getLayout().placements.every(p => p.bounds.y >= geometry.bottom - 1), 'native views receive status geometry');
    report.layouts.push({ width, status, ...geometry });
    if (status === 'pending') writeFileSync(join(output, `${locale}-single-row-${width}.png`), (await win.capturePage()).toPNG());
  }
  report.cases.push('three-site chips and bounded 250px input; 512-character query with zero/pending/unavailable synthetic states');
};
