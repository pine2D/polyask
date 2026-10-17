const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

module.exports = async ({ win, run, paint, wait, click, position, before, density, output, locale }) => {
  const reports = [];
  for (const zoom of [1, 1.25, 1.5, 2]) {
    win.setContentSize(960, 680); win.webContents.setZoomFactor(zoom); await paint();
    const measure = () => run(`(() => {
      const bar=document.querySelector('.command-bar'), rect=bar.getBoundingClientRect();
      const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
      const boxes=[...bar.querySelectorAll('button,select,.prompt-composer')].filter(visible).map(e=>{
        const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className,
          left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width};});
      return {width:innerWidth,height:rect.height,prompt:bar.querySelector('.prompt-composer').getBoundingClientRect().width,
        libraryVisible:bar.querySelector('.archive-trigger').getClientRects().length>0,
        overflow:bar.scrollWidth>bar.clientWidth+1,boxes};
    })()`);
    const expanded = await measure();
    assert.equal(expanded.prompt >= 320 && !expanded.overflow, true, `zoom ${zoom}: ${JSON.stringify(expanded)}`);
    assert.equal(expanded.libraryVisible, true, `library remains visible at zoom ${zoom}`);
    assert.equal(Math.abs(expanded.height - (zoom === 1 ? (density === 'compact' ? 120 : 144) : (density === 'compact' ? 200 : 240))) < 1, true);
    assert.equal(expanded.boxes.every(b => b.left >= -1 && b.right <= expanded.width + 1 && b.top >= 0 && b.bottom <= expanded.height + 1), true,
      `all visible controls fit at zoom ${zoom}: ${JSON.stringify(expanded.boxes)}`);
    const after = await position();
    assert.equal(after.start === before.start && after.end === before.end && after.direction === before.direction && after.value === before.value, true,
      'zoom preserves the existing editor and selection');
    assert.equal(Math.abs(after.scroll - before.scroll) < 1, true, 'scroll survives device-pixel rounding');
    if (zoom === 2) writeFileSync(join(output, `${locale}-${density}-zoom-200.png`), (await win.webContents.capturePage()).toPNG());
    reports.push({ zoom, ...expanded });
  }
  await click('[data-composer-toggle]');
  await wait(`Math.abs(document.querySelector('.command-bar').getBoundingClientRect().height-${density === 'compact' ? 120 : 144})<1`);
  await click('[data-composer-toggle]');
  await wait(`Math.abs(document.querySelector('.prompt-composer').getBoundingClientRect().height-${density === 'compact' ? 112 : 136})<1`);
  writeFileSync(join(output, `${locale}-${density}-zoom.json`), JSON.stringify(reports, null, 2));
};
