const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ win, run, output, label }) => {
  const result = await run(`(() => {
    const bar=document.querySelector('.command-bar'), rect=bar.getBoundingClientRect();
    const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
    const boxes=[...bar.querySelectorAll('button, .prompt-composer, .workspace-actions')].filter(visible).map(e=>{
      const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className,
        left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    });
    const style=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {
      width:r.width,height:r.height,color:s.color,background:s.backgroundColor,border:s.borderRadius};};
    return {bar:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},boxes,
      history:style(bar.querySelector('.question-trigger')),draft:style(bar.querySelector('[data-draft-open]'))};
  })()`);
  const failures = result.boxes.filter(box => box.left < result.bar.left - 1 || box.right > result.bar.right + 1 ||
    box.top < result.bar.top - 1 || box.bottom > result.bar.bottom + 1).map(box => `outside toolbar: ${box.name}`);
  for (const key of ['width', 'height', 'color', 'background', 'border']) {
    if (result.history[key] !== result.draft[key]) failures.push(`draft control differs from history: ${key}`);
  }
  if (failures.length) {
    writeFileSync(join(output, `${label}-toolbar-failure.png`), (await win.webContents.capturePage()).toPNG());
    writeFileSync(join(output, `${label}-toolbar-failure.json`), JSON.stringify({ ...result, failures }, null, 2));
  }
  assert.deepEqual(failures, [], `${label}: complete production toolbar must fit and reuse existing control styles`);
};
