const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], cases = [], errors = [];
let network = 0;
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const boundary = processBoundary(app, output);
const read = (win, code) => win.webContents.executeJavaScript(code);
const check = (ok, message) => { if (!ok) throw Error(message); };
const find = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function wait(win, code, label) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await read(win, code)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`timeout: ${label}`);
}
async function frames(win) {
  await read(win, 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
}
async function key(win, keyCode, modifiers = []) {
  await read(win, 'window.retryKeyUp=false');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
  await wait(win, 'window.retryKeyUp', 'trusted keyup');
  await frames(win);
}
async function click(win, selector) {
  const point = await read(win, `(()=>{const r=(${find(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const zoom = win.webContents.getZoomFactor();
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
    x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'left', clickCount: 1 });
  await frames(win);
}
async function geometry(win) {
  return read(win, `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};
    const panel=document.querySelector('[role=dialog]'), list=panel.querySelector('ul');
    const visible=e=>{const r=rect(e);return r.top>=0&&r.bottom<=innerHeight+.5&&r.left>=0&&r.right<=innerWidth+.5};
    return {width:innerWidth,height:innerHeight,panel:rect(panel),confirm:rect(panel.querySelector('footer button')),
      title:rect(panel.querySelector('h2')),cancel:rect(panel.querySelector('header button')),
      visible:[panel,panel.querySelector('h2'),panel.querySelector('header button'),panel.querySelector('footer button')].every(visible),
      list:{...rect(list),clientHeight:list.clientHeight,scrollHeight:list.scrollHeight,scrollTop:list.scrollTop},
      documentOverflow:document.documentElement.scrollWidth>innerWidth};})()`);
}
async function exercise(win, name, count) {
  await click(win, '#open-review');
  await wait(win, '!!document.querySelector("[role=dialog]")', 'review');
  await frames(win); boundary();
  const before = await geometry(win);
  writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  writeFileSync(join(output, `${name}-geometry.json`), JSON.stringify(before, null, 2));
  check(before.visible && !before.documentOverflow, `${name}: title, cancel, confirm and dialog must fit viewport: ${JSON.stringify(before)}`);
  check(before.list.scrollHeight > before.list.clientHeight && before.list.clientHeight >= 32, `${name}: independent usable list scroll`);
  check(await read(win, `${find('.retry-review-confirm')}.disabled && document.activeElement===${find('.folder-modal header button')}`), 'unchecked confirm disabled; default cancel focus');
  const visited = [];
  for (let index = 0; index < count * 2; index++) {
    await key(win, 'Tab');
    const focus = await read(win, `(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),list=document.querySelector('.broadcast-retry-review ul').getBoundingClientRect();
      return {id:e.value||e.dataset.inspectSite,visible:r.top>=list.top-.5&&r.bottom<=list.bottom+.5,type:e.tagName}})()`);
    check(focus.visible, `${name}: Tab choice ${index} visible in list: ${JSON.stringify(focus)}`);
    visited.push(focus.id);
  }
  check(new Set(visited).size === count, 'Tab visits every site checkbox and inspect button');
  const after = await geometry(win);
  check(after.list.scrollTop > 0, 'native Tab scrolls the list to final site');
  check(before.title.top === after.title.top && before.confirm.top === after.confirm.top, 'list focus preserves fixed actions');
  await key(win, 'Tab');
  check(await read(win, `document.activeElement===${find('.folder-modal header button')}`), 'Tab wraps past disabled confirm');
  await key(win, 'Tab', ['shift']);
  check(await read(win, 'document.activeElement===document.querySelector(".broadcast-retry-review li:last-child button")'), 'Shift+Tab wraps to final inspect');
  await key(win, 'Tab', ['shift']); await key(win, 'Space');
  await wait(win, `!${find('.retry-review-confirm')}.disabled`, 'explicit check enables confirm');
  await key(win, 'Tab'); await key(win, 'Tab');
  check(await read(win, `document.activeElement===${find('.retry-review-confirm')}`), 'checked confirm reachable');
  check((await geometry(win)).visible, 'actions remain visible after scroll and selection');
  for (const properties of [{ isComposing: true }, { keyCode: 229 }]) {
    await read(win, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...${JSON.stringify(properties)}}))`);
    check(await read(win, `!!${find('[role=dialog]')}`), 'IME Escape preserves review');
  }
  await read(win, 'window.retryViewport.setBusy(true)');
  await wait(win, `${find('.retry-review-confirm')}.disabled`, 'busy controls disabled');
  await key(win, 'Escape');
  check(await read(win, '!!document.querySelector("[role=dialog]") && [...document.querySelectorAll("[role=dialog] button,[role=dialog] input")].every(e=>e.disabled) && window.retryViewport.state.confirmed===0'), 'busy cannot cancel or resend');
  await read(win, 'window.retryViewport.setBusy(false)');
  await wait(win, `!${find('.retry-review-confirm')}.disabled`, 'idle restores confirm');
  await click(win, '.retry-review-confirm');
  await wait(win, '!document.querySelector("[role=dialog]") && window.retryViewport.state.confirmed===1', 'one deliberate confirm');
  check(await read(win, 'document.activeElement.id==="open-review"'), 'confirm returns opener focus');
  await click(win, '#open-review'); await key(win, 'Escape');
  await wait(win, '!document.querySelector("[role=dialog]") && document.activeElement.id==="open-review"', 'Escape cancels and returns focus');
  cases.push({ name, count, before, after, keyboardChoices: visited.length });
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { network++; callback({ cancel: true }); });
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) for (const density of ['compact', 'comfortable']) {
    for (const size of [{ width: 1366, height: 768, zoom: 1, count: 9 },
      { width: 960, height: 600, zoom: 2, count: 9 }, { width: 960, height: 600, zoom: 2, count: 3 }]) {
      const name = `${locale}-${theme}-${density}-${size.count}-${size.zoom * 100}`;
      nativeTheme.themeSource = theme;
      const win = new BrowserWindow({ width: size.width, height: size.height, useContentSize: true, show: true,
        webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
      win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
      try {
        await win.loadFile(join(output, 'index.html'), { query: { locale, theme, density, count: String(size.count) } });
        win.webContents.setZoomFactor(size.zoom);
        win.focus(); await wait(win, 'document.hasFocus() && window.retryViewport?.ready', 'native focus and fixture');
        await wait(win, `innerWidth===${size.width / size.zoom}&&innerHeight===${size.height / size.zoom}`, 'actual zoom viewport');
        check(await read(win, `matchMedia('(prefers-color-scheme:dark)').matches===${theme === 'dark'}`), 'actual color scheme');
        await read(win, 'window.addEventListener("keyup",e=>window.retryKeyUp=e.isTrusted,true)');
        await exercise(win, name, size.count);
        console.log(`${name}: pass`);
      } catch (error) {
        writeFileSync(join(output, `${name}-failure.png`), (await win.webContents.capturePage()).toPNG());
        throw error;
      } finally { boundary(); win.destroy(); }
    }
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ cases, errors, network }, null, 2));
  check(errors.length === 0 && network === 0, 'no renderer errors or external requests');
  app.exit(cases.length === 36 ? 0 : 1);
}).catch(error => { console.error(String(error)); app.exit(1); });
