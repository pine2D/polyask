const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const completed = [];
const read = (win, code) => win.webContents.executeJavaScript(code);
const check = (ok, message) => { if (!ok) throw Error(message); };
async function wait(win, code, label) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await read(win, code)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`timeout: ${label}`);
}
async function click(win, code) {
  await wait(win, `!!(${code}) && !(${code}).disabled`, 'click target');
  await read(win, `(${code}).scrollIntoView({block:'center'})`);
  const point = await read(win, `(()=>{const r=(${code}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
  check(point.w >= 24 && point.h >= 24, 'target >=24px');
  win.focus(); await wait(win, 'document.hasFocus()', 'native focus');
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type,
    x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
}
async function key(win, keyCode, modifiers = []) {
  await read(win, 'window.retryKeyUp=null');
  for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
  await wait(win, 'window.retryKeyUp===true', 'trusted keyup');
}
const find = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function reset(win, locale) {
  await win.loadFile(join(output, 'index.html'), { query: { locale } });
  await wait(win, 'window.retryState?.().ready', 'first synthetic result');
  await read(win, 'window.addEventListener("keyup",e=>window.retryKeyUp=e.isTrusted,true)');
}
async function open(win) {
  await click(win, find('#review'));
  await wait(win, '!!document.querySelector("[role=dialog]")', 'review');
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const width of [1200, 640]) {
    const win = new BrowserWindow({ width, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
    const label = `${locale}-${width}`;
    try {
      await reset(win, locale); await open(win);
      check(await read(win, 'document.activeElement===document.querySelector(".folder-modal header button")'), 'default cancel focus');
      check(await read(win, 'document.querySelector(".retry-review-confirm").disabled && window.retryState().calls.length===1'), 'unchecked cannot resend');
      await key(win, 'Tab', ['shift']);
      check(await read(win, 'document.activeElement===document.querySelector("[data-inspect-site=gemini]")'), 'Shift+Tab wraps past disabled confirm');
      await key(win, 'Tab');
      check(await read(win, 'document.activeElement===document.querySelector(".folder-modal header button")'), 'Tab wraps to cancel');
      for (const properties of [{ isComposing: true }, { keyCode: 229 }]) {
        await read(win, `window.retryIme=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true,...${JSON.stringify(properties)}});document.activeElement.dispatchEvent(window.retryIme)`);
        check(await read(win, '!window.retryIme.defaultPrevented && !!document.querySelector("[role=dialog]")'), 'IME Escape preserves review');
      }
      await key(win, 'Escape'); await wait(win, '!document.querySelector("[role=dialog]") && document.activeElement.id==="review"', 'cancel returns focus');
      await open(win); await click(win, find('[data-inspect-site=kimi]'));
      await wait(win, 'window.retryState().inspected==="kimi" && !document.querySelector("[role=dialog]")', 'inspect site');
      check(await read(win, 'window.retryState().calls.length===1'), 'inspection sends nothing');
      await open(win); await click(win, 'document.querySelector("input[value=kimi]").parentElement');
      await wait(win, '!document.querySelector(".retry-review-confirm").disabled', 'explicit selection');
      await read(win, 'window.retryEvidence()');
      await wait(win, '!document.querySelector("input[value=kimi]")', 'late evidence removes selected site');
      check(await read(win, 'document.querySelector(".retry-review-confirm").disabled && window.retryState().calls.length===1'), 'late sent cannot resend');
      await read(win, 'window.retryInvalidate()'); await wait(win, '!document.querySelector("[role=dialog]")', 'invalidated review');
      await reset(win, locale); await open(win);
      await click(win, 'document.querySelector("input[value=kimi]").parentElement');
      await wait(win, '!document.querySelector(".retry-review-confirm").disabled', 'selected confirm');
      writeFileSync(join(output, `${label}.png`), (await win.webContents.capturePage()).toPNG());
      await click(win, find('.retry-review-confirm'));
      await wait(win, 'window.retryState().calls.length===2', 'one deliberate resend');
      check(await read(win, '(()=>{const [a,b]=window.retryState().calls;return b.sites.join()===\'kimi\' && a.text===b.text && a.tier===b.tier && a.runId===b.runId && JSON.stringify(a.images)===JSON.stringify(b.images)})()'), 'original payload and checked scope');
      await reset(win, locale); await click(win, find('#ordinary'));
      await wait(win, 'window.retryState().calls.length===2', 'default manual retry');
      check(await read(win, 'window.retryState().calls[1].sites.join()===\'claude\''), 'default excludes uncertain and cancelled sites');
      console.log(JSON.stringify({ locale, width, ok: true }));
      completed.push({ locale, width, ok: true });
    } finally { win.destroy(); }
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(completed));
  app.exit(completed.length === 6 ? 0 : 1);
}).catch(error => { console.error(String(error)); app.exit(1); });
