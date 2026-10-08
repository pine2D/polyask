const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1280, height: 900, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    const deadline = Date.now() + 5000;
    while (!(await run(source))) {
      if (Date.now() >= deadline) throw Error(`Timeout: ${source}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const click = async selector => {
    // During a reversal the textarea retains its final size, clipped by the animated wrapper.
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=(e.matches('textarea')?e.parentElement:e).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
    assert.equal(point.width >= 24 && point.height >= 24, true, 'native target has a usable size');
    win.focus(); win.webContents.focus(); await wait('document.hasFocus()');
    const zoom = win.webContents.getZoomFactor();
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) });
    await paint();
    if (selector === 'textarea') assert.equal(await run('document.activeElement===document.querySelector("textarea")'), true, 'trusted click hits the visible editor during motion');
  };
  const position = () => run('(()=>{const e=document.querySelector("textarea");return {start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,scroll:e.scrollTop,value:e.value}})()');
  const reports = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const density of ['compact', 'comfortable']) {
    win.webContents.setZoomFactor(1);
    win.setContentSize(1280, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, density } });
    await wait('!!document.querySelector("textarea")');
    await click('textarea');
    const draft = 'Long question / 长问题 / 長問題\n'.repeat(40);
    await win.webContents.insertText(draft);
    // Set up the synthetic selection only after the controlled input commit and entry settle.
    await wait(`document.querySelector("#composer-inputs").textContent!=="0"&&document.querySelector("textarea").value.length>500&&Math.abs(document.querySelector(".prompt-composer").getBoundingClientRect().height-${density === 'compact' ? 112 : 136})<1`);
    await paint();
    // Explicit fixture setup of selection and scroll; subsequent actions use trusted native pointer/keys.
    await run('(()=>{const e=document.querySelector("textarea");e.setSelectionRange(17,43,"backward");e.scrollTop=190})()');
    const before = await position();
    for (const selector of ['[data-tier-icon="fast"]', '[data-tier-icon="think"]', '[name="attachment-control"]']) {
      await click(selector);
      assert.deepEqual(await position(), before, `editing context survives trusted action: ${selector}`);
      assert.equal(await run('document.querySelector(".command-bar").classList.contains("is-expanded")'), true);
    }
    assert.equal(await run('JSON.parse(document.querySelector("#composer-transitions").textContent).includes(false)'), false);
    const label = await run('document.querySelector("[data-current-tier]").textContent');
    assert.equal(label, locale === 'en' ? 'Think' : '深思');
    const layouts = [];
    for (const width of [960, 1101, 1280, 1401, 1600]) {
      win.setContentSize(width, 900); await paint();
      const bounds = await run('(()=>{const e=document.querySelector("[data-current-tier]"),s=document.querySelector(".send"),r=e.getBoundingClientRect(),b=s.getBoundingClientRect(),a=document.querySelector(".command-bar");return {width:innerWidth,labelVisible:r.width>0&&r.left>=0&&r.right<=innerWidth,sendVisible:b.width>=24&&b.right<=innerWidth,overflow:a.scrollWidth>a.clientWidth+1,height:a.getBoundingClientRect().height}})()');
      assert.equal(bounds.labelVisible && bounds.sendVisible && !bounds.overflow, true, `toolbar stays usable: ${JSON.stringify(bounds)}`);
      assert.equal(bounds.height, density === 'compact' ? 120 : 144);
      layouts.push(bounds);
    }
    win.setContentSize(1600, 900); win.webContents.setZoomFactor(1.5); await paint();
    assert.equal(await run('document.querySelector(".command-bar").scrollWidth<=innerWidth+1'), true, '150% toolbar fits');
    await click('[data-composer-toggle]');
    assert.equal(await run('document.activeElement===document.querySelector("[data-composer-toggle]")'), true);
    assert.equal(await run('document.querySelector("[data-composer-toggle]").getAttribute("aria-expanded")'), 'false');
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Space' });
    await wait('document.querySelector("[data-composer-toggle]").getAttribute("aria-expanded")==="true"');
    await click('textarea');
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Escape' });
    await wait('document.querySelector("[data-composer-toggle]").getAttribute("aria-expanded")==="false"');
    assert.equal(await run('document.activeElement===document.querySelector("textarea")'), true);
    await paint();
    writeFileSync(join(output, `${locale}-${density}.png`), (await win.webContents.capturePage()).toPNG());
    reports.push({ locale, density, label, layouts, zoom: 1.5, trustedPointerAndKeyboard: true,
      selectionScrollSetup: 'programmatic', physicalIme: 'not-tested', nativeFileDialog: 'not-tested' });
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(`Native composer passed: ${reports.length} language/density scenarios.`);
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
