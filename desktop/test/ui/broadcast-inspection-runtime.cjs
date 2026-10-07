const { app, BrowserWindow, session } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
let win;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']}, (_details, callback) => callback({cancel: true}));
  win = new BrowserWindow({width: 1400, height: 900, show: true, webPreferences: {sandbox: true, contextIsolation: true}});
  const js = source => win.webContents.executeJavaScript(source);
  const pause = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const check = (value, label) => { if (!value) throw Error(label); };
  const until = async (source, label) => {
    for (let i = 0; i < 150; i++) { if (await js(source)) return; await pause(); }
    throw Error(`Timeout: ${label}`);
  };
  const click = async selector => {
    win.focus(); await until('document.hasFocus()', 'window focus');
    const point = await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n||n.disabled)return null;n.scrollIntoView({block:'nearest'});
      const r=n.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2),hit=document.elementFromPoint(x,y);
      return hit===n||n.contains(hit)?{x,y}:null;})()`);
    check(!!point, `Missing native target: ${selector}`);
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({type, button:'left', clickCount:1, ...point});
    await pause();
  };
  const state = () => js('window.inspectionFixture.state()');
  await win.loadFile(join(output, 'index.html'));
  await until('!!document.querySelector("textarea[name=prompt]")', 'root bootstrap');
  await click('textarea[name=prompt]'); await win.webContents.insertText('Check the original site before retrying');
  await click('button.send');
  await until('!!document.querySelector(".uncertain-retry-trigger")', 'uncertain original run');
  // Synthetic Drive timing: main removes A before renderer receives the workspace event.
  await js('window.inspectionFixture.mainRemove("claude")');
  await click('.uncertain-retry-trigger'); await click('[data-inspect-site=claude]');
  await until('document.querySelector(".feedback-notice")?.textContent.includes("Claude is not open")', 'main rejected stale renderer selection');
  let result = await state();
  check(result.layouts.length === 0 && result.selections === 0 && result.inspections === 1 && result.selected.join() === 'claude,chatgpt' && result.sends === 1,
    'main rejection must produce guidance without focus, scope mutation or resend');
  await until('!!document.querySelector(".site-choice[data-site-key=claude] label")', 'site scope');
  await click('.site-choice[data-site-key=claude] label');
  result = await state();
  check(result.selected.join() === 'claude,chatgpt' && result.selections === 0, 'exclusion retains the open page without a page selection write');
  // External workspace removal remains distinct from the user's send checkbox.
  await js('window.inspectionFixture.mainRemove("claude", true)');
  await until('window.inspectionFixture.state().selected.join() === "chatgpt"', 'A removed and B kept');
  await click('.uncertain-retry-trigger'); await click('[data-inspect-site=claude]');
  await until('document.querySelector(".feedback-notice")?.textContent.includes("Claude is not open")', 'named closed-site guidance');
  result = await state();
  check(result.layouts.length === 0 && result.selections === 0 && result.selected.join() === 'chatgpt' && result.sends === 1,
    'closed-site inspection cannot focus B, alter scope, or send');
  check(await js('document.querySelector(".site-choice[data-site-key=claude] label") !== null'), 'guidance opens the site list');
  await click('.site-choice[data-site-key=claude] label');
  await until('window.inspectionFixture.state().selected.includes("claude")', 'manual reselection accepted');
  await click('.uncertain-retry-trigger');
  check(await js('!document.querySelector("input[name=retry-site]").checked'), 'inspection does not confirm an uncertain resend');
  await click('[data-inspect-site=claude]');
  await until('window.inspectionFixture.state().layouts.length === 1', 'requested original site focused');
  result = await state();
  check(result.layouts[0].mode === 'focus' && result.layouts[0].site === 'claude' && result.selections === 1 && result.sends === 1,
    'only explicit manual reselection permits focus A and never resends');
  writeFileSync(join(output, 'report.json'), JSON.stringify({ok:true, nativeInput:true, closedSiteBlocked:true, mainRejectionVisible:true,
    simulatedDriveRace:true, manualReselectionFocused:true, sends:result.sends}));
  app.exit(0);
}).catch(async error => {
  if (win && !win.isDestroyed()) writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  console.error(String(error.message).slice(0, 600)); app.exit(1);
});
