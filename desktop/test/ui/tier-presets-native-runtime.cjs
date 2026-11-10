const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], report = { cases: [], errors: [], network: 0 };
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => {});
let win, tools;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    report.network++; callback({ cancel: true });
  });
  win = new BrowserWindow({ width: 1440, height: 1050, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.setMenuBarVisibility(false);
  win.webContents.on('console-message', event => { if (event.level === 'error') report.errors.push(event.message.slice(0, 180)); });
  const state = { scenario: 'tier-presets', step: 'load', lastInput: null };
  tools = nativeReadingTools(win, output, state);
  const { js, click, key, until, check, pause } = tools, boundary = processBoundary(app, output);
  const cases = ['en', 'zh-CN', 'zh-TW'].flatMap(locale => ['light', 'dark'].flatMap(theme =>
    [720, 1440].map(width => ({ locale, theme, width, zoom: 1 }))));
  cases.push({ locale: 'zh-TW', theme: 'dark', width: 960, zoom: 2 });
  const shot = async name => {
    await js('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  for (const value of cases) {
    const { locale, theme, width, zoom } = value; state.step = `${locale}-${theme}-${width}-${zoom}`;
    win.setSize(width, 1050); nativeTheme.themeSource = theme;
    await win.loadFile(join(output, 'index.html'), { query: { locale } }); win.webContents.setZoomFactor(zoom);
    await until('document.querySelector("#claude-presets-title")?.getClientRects().length > 0', 'preset card visible');
    await pause(); boundary();
    check(await js('document.querySelector("#claude-think-model").options.length===1'), 'does not read page on mount');
    await click('[data-preset-action=refresh]');
    await until('document.querySelector("#claude-think-model").options.length===4', 'options loaded');
    await click('[data-preset-mode=think] [data-preset-action=current]');
    await until('document.querySelector("#claude-think-effort").value==="Extra"', 'current exact choice copied');
    // Native keyboard changes the effort in the focused HTML select.
    await js('document.querySelector("#claude-think-effort").focus()'); await key('End'); await key('Tab');
    check(await js('document.querySelector("#claude-think-effort").value==="Max"'), 'native keyboard chooses Max');
    const extra = locale === 'en' && theme === 'light' && width === 1440;
    if (extra) {
      await js('window.tierPresetFixture.fail()'); await click('[data-preset-mode=think] [data-preset-action=save]');
      await until('document.querySelector("#claude-presets-status").textContent===window.tierPresetFixture.copy.presetRestoreFailed', 'restoration failure is visible');
      check(await js('window.tierPresetFixture.saved().claudeThinkPreset===null'), 'failed save leaves preference unchanged');
      await js('document.querySelector("#claude-presets-title").scrollIntoView({block:"start"})'); await shot('en-light-failure-wide');
      const count = await js('window.tierPresetFixture.calls()');
      await js('window.tierPresetFixture.hold()'); await click('[data-preset-mode=think] [data-preset-action=save]'); await key('Space');
      check(await js('window.tierPresetFixture.calls()') === count + 1, 'pending save is single flight');
      await js('window.tierPresetFixture.release()');
    } else await click('[data-preset-mode=think] [data-preset-action=save]');
    await until('window.tierPresetFixture.saved().claudeThinkPreset?.effort==="Max"', 'exact choice saved');
    check(await js('document.activeElement===document.querySelector("[data-preset-mode=think] [data-preset-action=save]")'), 'focus restored after disabled fieldset');
    await click('[data-preset-mode=fast] [data-preset-action=current]');
    await click('[data-preset-mode=fast] [data-preset-action=save]');
    await until('window.tierPresetFixture.saved().claudeFastPreset?.effort==="Extra"', 'independent fast preset saved');
    const geometry = await js(`(()=>{const card=document.querySelector('.tier-presets');
      const ctx=document.createElement('canvas').getContext('2d');
      const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
      const luminance=v=>v.slice(0,3).map(x=>{const n=x/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const ratios=[...card.querySelectorAll('p,label,legend,button:not(:disabled),select:not(:disabled)')].filter(el=>el.textContent.trim()).map(el=>{
        let bg=[255,255,255,255];for(let parent=el;parent;parent=parent.parentElement){const c=rgb(getComputedStyle(parent).backgroundColor);if(c[3]>250){bg=c;break;}}
        const fg=luminance(rgb(getComputedStyle(el).color)),back=luminance(bg);return (Math.max(fg,back)+.05)/(Math.min(fg,back)+.05);});
      return {minContrast:Math.min(...ratios),
      viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
      bad:[...card.querySelectorAll('button,select')].filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect()).filter(r=>r.left< -1||r.right>innerWidth+1||r.height<32).length,
      labels:[...card.querySelectorAll('select')].every(el=>!!document.querySelector('label[for="'+el.id+'"]')),
      sizes:[...card.querySelectorAll('p,label,legend')].map(el=>parseFloat(getComputedStyle(el).fontSize))};})()`);
    check(!geometry.overflow && geometry.bad === 0, 'all controls fit the actual CSS viewport');
    check(geometry.labels && geometry.sizes.every(size => size >= 12), 'labels and text sizes');
    check(geometry.minContrast >= 4.5, 'text contrast meets 4.5:1');
    if ((locale === 'zh-CN' && theme === 'dark' && width === 1440) || (locale === 'en' && theme === 'light' && width === 720) || zoom === 2) {
      await js('document.querySelector("#claude-presets-title").scrollIntoView({block:"start"})'); await shot(state.step);
      if(zoom===2){await js('document.querySelector("[data-preset-mode=think]").scrollIntoView({block:"start"})');await shot(state.step+'-think');}
    }
    // IME Escape must not close settings; regular Escape remains available after save.
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true}))');
    check(await js('document.body.dataset.closed!=="true"'), 'IME escape does not leave settings');
    await click('[data-preset-mode=think] [data-preset-action=reset]');
    await until('window.tierPresetFixture.saved().claudeThinkPreset===null', 'recommendation restored');
    boundary(); report.cases.push({ ...value, ...geometry });
  }
  check(report.errors.length === 0, 'no renderer errors');
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  win.destroy(); app.quit();
}).catch(async error => {
  report.errors.push(String(error.message)); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (tools) await tools.failure(error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1);
});
