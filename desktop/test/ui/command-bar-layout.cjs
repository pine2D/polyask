const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ win, run, output, label }) => {
  // 命令栏适配（toolbar-fit.ts）在尺寸变化后的下一次渲染更新里完成；先等两帧再量。
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const result = await run(`(() => {
    const bar=document.querySelector('.command-bar'), rect=bar.getBoundingClientRect();
    const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
    const boxes=[...bar.querySelectorAll('button, .prompt-composer, .workspace-actions')].filter(visible).map(e=>{
      const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.className,
        left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
    });
    // 按钮外框在栏内，不代表新增的文字/图标仍在按钮内；不能只检查外框。
    const contents=[...bar.querySelectorAll('.primary-action, .new-session-trigger, .workspace-actions > button')].filter(visible).flatMap(button=>{
      const owner=button.getBoundingClientRect();
      return [...button.children].filter(visible).map(child=>{
        const r=child.getBoundingClientRect();return {name:button.getAttribute('aria-label'),part:child.tagName,
          left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          owner:{left:owner.left,right:owner.right,top:owner.top,bottom:owner.bottom}};
      });
    });
    // 窄栏把历史入口收进更多菜单（display:none）时，改比两者的计算尺寸，仍要求同一套控件样式。
    const folded=!visible(bar.querySelector('.question-trigger'));
    const style=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {
      width:folded?s.minWidth:r.width,height:folded?s.height:r.height,color:s.color,background:s.backgroundColor,border:s.borderRadius};};
    return {bar:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},boxes,contents,
      actions:[...bar.querySelectorAll('.prompt-composer,.new-session-trigger,.question-trigger,.draft-trigger,.send,.archive-trigger')].filter(visible).map(e=>{
        const r=e.getBoundingClientRect();return {name:e.className,left:r.left,right:r.right,top:r.top,bottom:r.bottom};}),
      prompt:bar.querySelector('.prompt-composer').getBoundingClientRect().width,
      history:style(bar.querySelector('.question-trigger')),draft:style(bar.querySelector('[data-draft-open]'))};
  })()`);
  const failures = result.boxes.filter(box => box.left < result.bar.left - 1 || box.right > result.bar.right + 1 ||
    box.top < result.bar.top - 1 || box.bottom > result.bar.bottom + 1).map(box => `outside toolbar: ${box.name}`);
  for (const part of result.contents) {
    if (part.left < part.owner.left - 1 || part.right > part.owner.right + 1 ||
      part.top < part.owner.top - 1 || part.bottom > part.owner.bottom + 1) failures.push(`outside button: ${part.name} ${part.part}`);
  }
  for (const [index, a] of result.actions.entries()) for (const b of result.actions.slice(index + 1)) {
    if (Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
      failures.push(`overlapping actions: ${a.name} / ${b.name}`);
  }
  if (result.prompt < 320) failures.push(`prompt narrower than 320px: ${result.prompt}`);
  for (const key of ['width', 'height', 'color', 'background', 'border']) {
    if (result.history[key] !== result.draft[key]) failures.push(`draft control differs from history: ${key}`);
  }
  if (failures.length) {
    writeFileSync(join(output, `${label}-toolbar-failure.png`), (await win.webContents.capturePage()).toPNG());
    writeFileSync(join(output, `${label}-toolbar-failure.json`), JSON.stringify({ ...result, failures }, null, 2));
  }
  assert.deepEqual(failures, [], `${label}: complete production toolbar must fit and reuse existing control styles`);
};
