const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const report = [];
const check = (value, message) => { if (!value) throw Error(message); };
async function wait(win, expression, label) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`timeout: ${label}`);
}
const read = (win, expression) => win.webContents.executeJavaScript(expression);
const find = (selector) => `document.querySelector(${JSON.stringify(selector)})`;
const textButton = (key) => `[...document.querySelectorAll('button')].find(el=>el.textContent===window.recoveryFixture.copy[${JSON.stringify(key)}])`;
async function click(win, expression) {
  await wait(win, `!!(${expression}) && !(${expression}).disabled`, 'enabled click target');
  await read(win, `(${expression}).scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await read(win, `(()=>{const el=${expression},r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height,visible:getComputedStyle(el).visibility!=='hidden'}})()`);
  check(point.visible && point.width >= 24 && point.height >= 24,
    `native click target must be visible and at least 24px: ${expression}; width=${point.width}; height=${point.height}; visible=${point.visible}`);
  win.focus(); await wait(win, 'document.hasFocus()', 'window focus');
  win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(point.x), y: Math.round(point.y), button: 'left', clickCount: 1 });
}
async function key(win, keyCode, modifiers = []) {
  await read(win, 'window.recoveryKeyUp=null');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(win, '!!window.recoveryKeyUp?.trusted', 'trusted keyup');
}
async function type(win, selector, value) {
  await click(win, find(selector));
  await wait(win, `document.activeElement===${find(selector)}`, 'text input focus');
  await key(win, 'A', ['control']);
  await read(win, 'window.recoveryInputTrusted=false');
  await win.webContents.insertText(value);
  await wait(win, `${find(selector)}.value===${JSON.stringify(value)} && window.recoveryInputTrusted===true`, 'trusted text input');
}
async function navigate(win, section) {
  await read(win, `window.recoveryFixture.navigate(${JSON.stringify(section)})`);
  const id = section === 'data' ? 'settings-advanced-toggle' : 'settings-display-title';
  await wait(win, `document.activeElement?.id===${JSON.stringify(id)}`, 'explicit settings navigation');
}
async function shot(win, name) {
  writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}
async function visualBounds(win, selector) {
  const result = await read(win, `(()=>{const elements=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>el.getClientRects().length);return {
    count:elements.length, fonts:elements.every(el=>parseFloat(getComputedStyle(el).fontSize)>=12),
    fits:elements.every(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left-1&&r.right<=p.right+1&&el.scrollWidth<=el.clientWidth+1}),
    targets:elements.filter(el=>el.matches('button,summary,label')).every(el=>{const r=el.getBoundingClientRect();return r.width>=24&&r.height>=24})}})()`);
  check(result.count > 0 && result.fonts && result.fits && result.targets, 'visible helper text and controls must fit at accessible sizes');
}
async function settingsFlow(win, name) {
  await wait(win, '!!window.recoveryFixture && !!document.querySelector(".settings-advanced")', 'settings disclosure');
  check(await read(win, '!document.querySelector(".settings-advanced").open'), 'advanced starts collapsed');
  check(await read(win, 'document.querySelectorAll(".settings-display fieldset").length===2'), 'two display groups');
  await read(win, 'document.querySelector(".settings-advanced > summary").focus()');
  for (let count = 0; count < 16; count++) {
    await key(win, 'Tab');
    check(await read(win, '!document.activeElement?.closest(".settings-advanced > section")'), 'collapsed destructive controls stay outside native Tab order');
  }
  await navigate(win, 'data');
  await click(win, find('.settings-advanced > summary'));
  await wait(win, '!document.querySelector(".settings-advanced").open', 'advanced collapse');
  await navigate(win, 'data');
  await read(win, 'window.recoveryFixture.holdCounts()');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!!document.querySelector("[data-local-confirm]")?.disabled && document.activeElement?.textContent===window.recoveryFixture.copy.cancel', 'loading and default cancel');
  await click(win, textButton('cancel'));
  await read(win, 'window.recoveryFixture.releaseCounts()');
  await wait(win, '!document.querySelector("[role=dialog]")', 'cancel late read');
  check(await read(win, 'document.activeElement?.textContent===window.recoveryFixture.copy.clearHistoryAction'), 'cancel restores opener focus');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!document.querySelector("[data-local-confirm]").disabled', 'counts loaded');
  await click(win, textButton('localDataBackupFirst'));
  await wait(win, '!document.querySelector("[role=dialog]") && document.activeElement?.textContent===window.recoveryFixture.copy.backupExport', 'backup navigation');
  check(await read(win, 'window.recoveryFixture.calls.exports===0 && window.recoveryFixture.calls.clears===0'), 'backup navigation only');
  await navigate(win, 'data');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!document.querySelector("[data-local-confirm]").disabled', 'second counts loaded');
  const ime = await read(win, `(()=>{const event=new KeyboardEvent('keydown',{key:'Escape',keyCode:229,bubbles:true,cancelable:true});window.dispatchEvent(event);return !event.defaultPrevented&&!!document.querySelector('[role=dialog]')})()`);
  check(ime, 'simulated composition Escape preserves native default and confirmation');
  await click(win, find('[data-local-confirm]'));
  // The first same-count confirmation has completed; restart to test changed scope.
  await wait(win, '!document.querySelector("[role=dialog]")', 'initial clear');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!document.querySelector("[data-local-confirm]").disabled', 'changed scope ready');
  await read(win, 'window.recoveryFixture.setHistory(3)');
  await click(win, find('[data-local-confirm]'));
  await wait(win, '!!document.querySelector(".local-counts-changed")', 'changed scope retained');
  check(await read(win, 'window.recoveryFixture.calls.clears===1'), 'changed counts cannot clear');
  await click(win, find('[data-local-confirm]'));
  await wait(win, '!document.querySelector("[role=dialog]") && document.querySelector(".archive-status").textContent===window.recoveryFixture.copy.localDataHistoryCleared.replace("{count}","4")', 'actual clear feedback');
  await read(win, 'window.recoveryFixture.failStats()');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!!document.querySelector("[role=dialog] [role=alert]") && document.querySelector("[data-local-confirm]").disabled', 'stats failure');
  await click(win, textButton('localDataStatsRetry'));
  await wait(win, '!document.querySelector("[data-local-confirm]").disabled', 'stats reread');
  await read(win, 'document.querySelector("[data-local-confirm]").focus()');
  await key(win, 'Tab');
  check(await read(win, 'document.activeElement?.textContent===window.recoveryFixture.copy.localDataBackupFirst'), 'Tab wraps to first visible confirmation control');
  await key(win, 'Tab', ['shift']);
  check(await read(win, 'document.activeElement===document.querySelector("[data-local-confirm]")'), 'Shift+Tab wraps back to confirmation action');
  await key(win, 'Escape');
  await wait(win, '!document.querySelector("[role=dialog]")', 'confirmation Escape');
  await read(win, 'window.recoveryFixture.failWrite()');
  await click(win, textButton('clearHistoryAction'));
  await wait(win, '!document.querySelector("[data-local-confirm]").disabled', 'write attempt ready');
  await click(win, find('[data-local-confirm]'));
  await wait(win, '!!document.querySelector("[role=dialog] [role=alert]") && !document.querySelector("[data-local-confirm]").disabled', 'write failure stays retryable');
  await click(win, find('[data-local-confirm]'));
  await wait(win, '!document.querySelector("[role=dialog]")', 'write retry');
  await navigate(win, 'display');
  await read(win, 'window.recoveryFixture.failDisplay()');
  await click(win, `${find('input[name=settings-density][value=comfortable]')}.closest('label')`);
  await wait(win, '!!document.querySelector(".settings-display [role=alert]")', 'display failure');
  check(await read(win, 'document.querySelector("input[name=settings-density][value=compact]").checked'), 'failed display keeps accepted value');
  await click(win, `${find('input[name=settings-density][value=comfortable]')}.closest('label')`);
  await wait(win, 'document.querySelector("input[name=settings-density][value=comfortable]").checked', 'density accepted');
  await click(win, `${find('input[name=settings-site-scale][value="1"]')}.closest('label')`);
  await wait(win, `${find('input[name=settings-site-scale][value="1"]')}.checked`, 'site scale accepted');
  await navigate(win, 'data');
  await type(win, '[name=clear-cloud-confirmation]', 'DELETE');
  await click(win, find('.settings-advanced > summary')); await click(win, find('.settings-advanced > summary'));
  check(await read(win, 'document.querySelector("[name=clear-cloud-confirmation]").value==="DELETE"'), 'folding preserves DELETE');
  await click(win, textButton('syncClear'));
  await wait(win, 'document.querySelector(".panel-close").disabled', 'cloud write exit lock');
  check(await read(win, 'window.recoveryFixture.calls.blocking.at(-1)===true'), 'cloud write reports the parent navigation lock');
  await click(win, find('.settings-advanced > summary'));
  check(await read(win, 'document.querySelector(".settings-advanced").open'), 'cloud write keeps progress visible');
  await key(win, 'Escape');
  check(await read(win, 'window.recoveryFixture.calls.closes===0'), 'cloud write prevents Escape exit');
  await read(win, 'window.recoveryFixture.releaseCloud()');
  await wait(win, '!document.querySelector(".panel-close").disabled', 'cloud write completes');
  check(await read(win, 'window.recoveryFixture.calls.blocking.at(-1)===false'), 'settled cloud write releases the parent navigation lock');
  const minFont = await read(win, 'Math.min(...[...document.querySelectorAll(".settings-display fieldset p,.settings-advanced-hint")].map(el=>parseFloat(getComputedStyle(el).fontSize)))');
  check(minFont >= 12, 'settings helper font is at least 12px');
  await visualBounds(win, '.settings-display-options label,.settings-display fieldset>p,.settings-advanced>summary,.settings-advanced-hint');
  await shot(win, `${name}-settings`);
}
async function healthFlow(win, name) {
  for (const reason of ['control', 'unconfirmed', 'capture', 'busy', 'page']) {
    await read(win, `window.recoveryFixture.health(${JSON.stringify(reason)})`);
    await wait(win, `document.querySelector('.health-first-step')?.dataset.reason===${JSON.stringify(reason)}`, 'health machine advice');
    if (reason === 'busy') {
      await click(win, find('.health-more-recovery > summary'));
      check(await read(win, '[...document.querySelectorAll(".health-more-recovery button")].every(el=>el.disabled)'), 'busy blocks all reload variants');
      await visualBounds(win, '.health-first-step>p,.health-first-step>button,.health-more-recovery>summary,.health-more-recovery>p,.health-more-recovery button');
      await shot(win, `${name}-health-busy`);
    } else {
      await click(win, find('.health-first-step button'));
      await click(win, textButton('healthCopyReport'));
    }
  }
  check(await read(win, 'JSON.stringify(window.recoveryFixture.calls.health)===JSON.stringify(["focus","report","focus","report","focus","report","reload","report"])'), 'only expected manual health callbacks');
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1200, 640]) {
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    const win = new BrowserWindow({ width, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const name = `${locale}-${width}`;
    try {
      await win.loadFile(join(output, 'index.html'), { query: { locale } });
      await settingsFlow(win, name); await healthFlow(win, name);
      if (locale === 'en' && width === 640) {
        win.webContents.setZoomFactor(1.5);
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
        await wait(win, 'matchMedia("(forced-colors:active)").matches && matchMedia("(prefers-reduced-motion:reduce)").matches', 'forced colors and reduced motion');
        await visualBounds(win, '.health-first-step>p,.health-first-step>button,.health-more-recovery>summary,.health-more-recovery>p,.health-more-recovery button');
        await shot(win, `${name}-health-forced-colors-150`);
        await navigate(win, 'display');
        await visualBounds(win, '.settings-display-options label,.settings-display fieldset>p,.settings-advanced>summary');
        await shot(win, `${name}-settings-forced-colors-150`);
        win.webContents.debugger.detach();
      }
      report.push({ locale, width, ok: true, simulatedIme: true, nativeInput: true });
    } catch (error) { report.push({ locale, width, ok: false, error: String(error) }); }
    finally { win.destroy(); }
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); app.exit(report.every(item => item.ok) ? 0 : 1);
}).catch(error => { console.error(String(error)); app.exit(1); });
