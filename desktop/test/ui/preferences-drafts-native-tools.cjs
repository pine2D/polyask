const fs = require('node:fs');
const { join } = require('node:path');
module.exports = (win, output, name) => {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    const deadline = Date.now() + 8000;
    while (!(await run(source))) {
      if (Date.now() >= deadline) {
        fs.writeFileSync(join(output, `${name}-failure.png`), (await win.webContents.capturePage()).toPNG());
        const evidence = await run(`({lastClick:window.nativeLastClick??null,activeTag:document.activeElement?.tagName,
          activeName:document.activeElement?.getAttribute('name'),selectionLength:window.getSelection()?.toString().length??0})`);
        fs.writeFileSync(join(output, `${name}-failure.json`), JSON.stringify({ source, ...evidence }, null, 2));
        throw Error('Native UI timeout: ' + source);
      }
      await pause(25);
    }
  };
  const clickElement = async expression => {
    // Styled switches expose a visible span; their native checkbox is one pixel.
    const target = `(() => {const node=(${expression});return node?.matches('.preference-switch input')?node.nextElementSibling:node})()`;
    await wait(`!!(${expression}) && !(${expression}).disabled && (${target}).getBoundingClientRect().width>0 && (${target}).getBoundingClientRect().height>0`);
    await run(`(${target}).scrollIntoView({block:'center',behavior:'instant'})`);
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await wait(`(() => {const node=(${target}),r=node.getBoundingClientRect();
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===node||node.contains(hit);})()`);
    const point = await run(`(() => { const r=(${target}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await run(`(() => { const node=(${target}); window.nativeLastClick=null;
      document.addEventListener('click',event=>window.nativeLastClick={trusted:event.isTrusted,hit:event.target===node||node.contains(event.target),
        tag:event.target.tagName,name:event.target.getAttribute('name')}, {once:true,capture:true}); })()`);
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
      x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
    await wait('window.nativeLastClick?.trusted && window.nativeLastClick.hit');
  };
  const click = selector => clickElement(`document.querySelector(${JSON.stringify(selector)})`);
  const clickText = (selector, text) => clickElement(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent===${JSON.stringify(text)})`);
  const key = (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
  };
  const type = async (selector, value) => {
    await click(selector);
    await wait(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
    key('A', ['control']);
    await pause(20);
    await win.webContents.insertText(value);
    await wait(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`);
  };
  return { run, wait, pause, click, clickElement, clickText, key, type };
};
