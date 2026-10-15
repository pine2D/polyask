const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2], matrix = [], interaction = [];
app.setPath('userData', join(output, 'profile'));
let win, deadline, requests = 0, step = 'startup', lastKey = null;
const check = (ok, message) => { if (!ok) throw Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = source => win.webContents.executeJavaScript(source);
async function until(source) {
  const end = Math.min(deadline, Date.now() + 4000);
  while (!await js(source)) { check(Date.now() < end, 'motion timeout: ' + source); await pause(10); }
}
const frames = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
const trigger = '.library-select,.library-menu-trigger';
async function focus() { win.focus(); win.webContents.focus(); await until('document.hasFocus()'); }
async function click(selector) {
  await focus();
  const p = await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;
    const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    window.motionClick=null;document.addEventListener('click',e=>window.motionClick={trusted:e.isTrusted,hit:n===e.target||n.contains(e.target),
      entering:document.querySelector('.library-popover')?.getAnimations().some(a=>a.playState==='running')??false},{once:true,capture:true});
    return {x,y,hit:n===hit||n.contains(hit)};})()`);
  check(p?.hit, 'visible native motion target: ' + selector);
  const z = win.webContents.getZoomFactor(), point = { x: Math.round(p.x * z), y: Math.round(p.y * z) };
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await until('window.motionClick!==null'); const input = await js('window.motionClick');
  check(input.trusted && input.hit, 'trusted native motion click'); return input;
}
async function key(keyCode) {
  await focus();
  await js('window.libraryMotion.lastKey=null');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  await until('window.libraryMotion.lastKey!==null'); await frames();
  lastKey = await js('window.libraryMotion.lastKey'); check(lastKey?.trusted, 'trusted native motion key');
}
async function open(entry, reduced = false) {
  win.webContents.setZoomFactor(1); win.setContentSize(entry.placement === 'above' ? 640 : 1200, 720);
  nativeTheme.themeSource = entry.theme ?? 'light';
  await win.loadFile(join(output, 'index.html'), { query: entry });
  win.webContents.setZoomFactor(Number(entry.zoom ?? 1));
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await until(`!!document.querySelector('${trigger}')`); await frames();
}
async function sample() {
  await js(`(()=>{window.motionFrames=[];window.motionSampling=true;const tick=()=>{if(!window.motionSampling)return;
    const p=document.querySelector('.library-popover');if(p){const s=getComputedStyle(p),n=document.querySelector('[data-stationary]').getBoundingClientRect();
      window.motionFrames.push({time:performance.now(),opacity:Number(s.opacity),transform:s.transform,width:p.offsetWidth,height:p.offsetHeight,
        stationary:{x:n.x,y:n.y,width:n.width,height:n.height},animations:p.getAnimations().map(a=>({state:a.playState,duration:a.effect.getTiming().duration,properties:a.effect.getKeyframes().flatMap(f=>Object.keys(f).filter(k=>['transform','opacity','left','top','width','height'].includes(k)))}))});}
    requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`);
}
async function finishSample() {
  await until("window.motionFrames.length>1&&document.querySelector('.library-popover')?.getAnimations().length===0");
  await frames();
  return js('(()=>{window.motionSampling=false;return window.motionFrames})()');
}
async function pointerCase(entry) {
  step = `pointer:${entry.kind}:${entry.locale}:${entry.theme}:${entry.placement}:${entry.zoom ?? 1}`;
  await open(entry); await sample(); await click(trigger); await until("!!document.querySelector('.library-popover')");
  const samples = await finishSample();
  check(samples.some(s => s.opacity > 0 && s.opacity < .999 && s.transform !== 'none'), 'pointer opening has intermediate opacity and transform');
  check(samples.every(s => s.width === samples[0].width && s.height === samples[0].height && JSON.stringify(s.stationary) === JSON.stringify(samples[0].stationary)), 'motion keeps layout and reading area stationary');
  check(samples.every(s => s.animations.every(a => a.properties.every(k => ['opacity', 'transform'].includes(k)))), 'motion only composites transform and opacity');
  check(samples.every(s => s.animations.every(a => a.duration > 0 && a.duration <= 160)), 'tool entry stays within the 160ms budget');
  if (entry.kind === 'select') check(await js("new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.library-select > svg')).transform).a<-.999"), 'selector arrow acknowledges the open state');
  const anchor = await js(`(()=>{const p=document.querySelector('.library-popover'),t=document.querySelector('${trigger}').getBoundingClientRect(),s=getComputedStyle(p);
    return {x:parseFloat(s.transformOrigin),y:parseFloat(s.transformOrigin.split(' ')[1]),height:p.offsetHeight,
      expectedX:Math.max(0,Math.min(p.offsetWidth,t.x+t.width/2-parseFloat(p.style.left))),top:parseFloat(p.style.top),bottom:t.bottom,triggerTop:t.top,
      overflow:p.getBoundingClientRect().right>innerWidth+1};})()`);
  check(Math.abs(anchor.x - anchor.expectedX) < 1.1 && Math.abs(anchor.y - (entry.placement === 'above' ? anchor.height : 0)) < 1.1, 'popover origin follows the actual trigger and opening side');
  check(!anchor.overflow && (entry.placement === 'above' ? anchor.top < anchor.triggerTop : anchor.top > anchor.bottom), 'popover stays anchored inside the viewport');
  if (entry.locale === 'en' && entry.theme === 'light' && entry.kind === 'select') {
    writeFileSync(join(output, `${entry.placement}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await key('Escape');
  check(await js(`!document.querySelector('.library-popover')&&document.activeElement===document.querySelector('${trigger}')`), 'Escape closes immediately and restores focus');
  matrix.push({ ...entry, samples, anchor });
}
async function interactions(kind) {
  const entry = { kind, placement: 'below', locale: 'en', theme: 'light' };
  step = `${kind}:keyboard-open`;
  await open(entry); await key('Tab'); await key('Return');
  await until("!!document.querySelector('.library-popover')");
  check(await js("document.querySelector('.library-popover').getAnimations().length===0&&getComputedStyle(document.querySelector('.library-popover')).opacity==='1'"), 'keyboard opens without animation');
  await key('Escape');
  step = `${kind}:keyboard-takeover`;
  await click(trigger); await until("!!document.querySelector('.library-popover')");
  await key('Down');
  check(lastKey.entering, 'keyboard takeover occurs during an actual running entry');
  check(await js("document.querySelector('.library-popover').getAnimations().length===0"), 'keyboard takeover cancels pointer animation');
  await key('Escape');
  step = `${kind}:rapid-toggle`;
  await click(trigger); const closeInput = await click(trigger);
  check(closeInput.entering, 'rapid close interrupts an actual running entry');
  check(await js("!document.querySelector('.library-popover')"), 'rapid close leaves no delayed overlay');
  step = `${kind}:choose-during-entry`;
  await click(trigger); await until("!!document.querySelector('.library-popover')");
  const actionInput = await click(kind === 'menu' ? '.library-action-menu button' : '.library-options [role=option]:nth-child(2)');
  check(actionInput.entering, 'selection works during an actual running entry');
  check(await js("window.libraryMotion.changes===1&&!document.querySelector('.library-popover')"), 'actions work during entry without waiting');
  step = `${kind}:disable-during-entry`;
  await click(trigger); await js('window.libraryMotion.disable()'); await frames();
  check(await js('window.libraryMotion.disabledDuringEntry'), 'disable interrupts an actual running entry');
  check(await js("!document.querySelector('.library-popover')"), 'disabling a trigger removes its entering overlay');
  step = `${kind}:reduced-motion`;
  await open(entry, true); await sample(); await click(trigger); await until("!!document.querySelector('.library-popover')"); await frames();
  check(await js("document.querySelector('.library-popover').getAnimations().length===0&&getComputedStyle(document.querySelector('.library-popover')).transform==='none'&&getComputedStyle(document.querySelector('.library-popover')).opacity==='1'"), 'reduced motion keeps immediate visible feedback');
  if (kind === 'select') check(await js("new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.library-select > svg')).transform).a<-.999&&document.querySelector('.library-select > svg').getAnimations().length===0"), 'reduced motion retains the arrow state without a transition');
  await key('Escape');
  step = `${kind}:assistive-click`;
  await open(entry); await js(`document.querySelector('${trigger}').click()`); await frames();
  check(await js("!!document.querySelector('.library-popover')&&document.querySelector('.library-popover').getAnimations().length===0&&getComputedStyle(document.querySelector('.library-popover')).opacity==='1'"), 'detail-zero activation opens without animation');
  if (kind === 'select') check(await js("document.querySelector('.library-select > svg').getAnimations().length===0"), 'detail-zero selector keeps its arrow immediate');
  await key('Escape'); interaction.push({ kind, keyboard: true, reduced: true, interrupt: true, immediateClose: true, assistive: true,
    closeInput, actionInput, disabledDuringEntry: true });
}
app.whenReady().then(async () => {
  deadline = Date.now() + 45000;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => { requests++; cb({ cancel: true }); });
  win = new BrowserWindow({ width: 1200, height: 720, useContentSize: true, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.debugger.attach('1.3');
  let error = null;
  try {
    for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark'])
      for (const placement of ['below', 'above']) for (const kind of ['select', 'menu']) await pointerCase({ locale, theme, placement, kind });
    for (const kind of ['select', 'menu']) await pointerCase({ locale: 'en', theme: 'light', placement: 'above', kind, zoom: '1.5' });
    for (const kind of ['select', 'menu']) await interactions(kind);
    check(requests === 0, 'motion fixture makes no HTTP requests');
  } catch (caught) { error = String(caught.message).slice(0, 240); }
  const diagnostics = error && win.webContents.getURL().startsWith('file:') ? await js(`(()=>{const p=document.querySelector('.library-popover'),t=document.querySelector('${trigger}');
    return {activeTag:document.activeElement?.tagName,expanded:t?.getAttribute('aria-expanded'),method:p?.dataset.inputMethod,changes:window.libraryMotion?.changes};})()`) : null;
  const report = { ok: !error, error, matrix, interaction, requests, step, lastKey, diagnostics };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report));
  console.log(JSON.stringify({ artifact: output, ok: report.ok, error, layouts: matrix.length, interactions: interaction.length, requests, ...(error ? { step, lastKey, diagnostics } : {}) }));
  win.destroy(); app.exit(report.ok ? 0 : 1);
}).catch(error => { console.error(String(error.message).slice(0, 240)); app.exit(1); });
