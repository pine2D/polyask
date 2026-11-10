const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2], report = { cases: [], sites: [], errors: [], network: 0 };
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
    await until('document.querySelector("#tier-presets-title")?.getClientRects().length > 0', 'preset card visible');
    check(await js('document.querySelector("[data-settings-section=models]").getAttribute("aria-current")==="location"'), 'presets have a dedicated category');
    check(await js('document.querySelectorAll("[data-settings-section]").length===8'), 'eight settings categories');
    await pause(); boundary();
    check(await js('document.querySelector("#claude-think-model").options.length===1'), 'does not read page on mount');
    if (locale === 'zh-CN' && theme === 'light' && width === 1440) await shot('zh-CN-light-empty');
    await click('[data-preset-action=refresh]');
    await until('document.querySelector("#claude-think-model").options.length===4', 'options loaded');
    await click('[data-preset-mode=think] [data-preset-action=current]');
    await until('document.querySelector("#claude-think-effort").value==="Extra"', 'current exact choice copied');
    // Native keyboard changes the effort in the focused HTML select.
    await js('document.querySelector("#claude-think-effort").focus()'); await key('End'); await key('Tab');
    check(await js('document.querySelector("#claude-think-effort").value==="Max"'), 'native keyboard chooses Max');
    if (locale === 'zh-CN' && theme === 'light' && width === 1440) await shot('zh-CN-light-unsaved');
    const extra = locale === 'en' && theme === 'light' && width === 1440;
    if (extra) {
      await js('window.tierPresetFixture.fail()'); await click('[data-preset-mode=think] [data-preset-action=save]');
      await until('document.querySelector("[data-preset-mode=think] [data-preset-feedback]").textContent===window.tierPresetFixture.copy.presetRestoreFailed', 'restoration failure is beside the affected tier');
      check(await js('window.tierPresetFixture.saved().claudeThinkPreset===null'), 'failed save leaves preference unchanged');
      await js('document.querySelector("#tier-presets-title").scrollIntoView({block:"start"})'); await shot('en-light-failure-wide');
      const count = await js('window.tierPresetFixture.calls()');
      await js('window.tierPresetFixture.hold()'); await click('[data-preset-mode=think] [data-preset-action=save]'); await key('Space');
      check(await js('window.tierPresetFixture.calls()') === count + 1, 'pending save is single flight');
      await js('window.tierPresetFixture.release()');
    } else await click('[data-preset-mode=think] [data-preset-action=save]');
    await until('window.tierPresetFixture.saved().claudeThinkPreset?.effort==="Max"', 'exact choice saved');
    await until('document.activeElement.id==="claude-think-title"', 'focus stays in the saved tier when its save button becomes disabled');
    check(await js('document.querySelector("[data-preset-mode=think] [data-preset-action=save]").disabled'), 'unchanged preset cannot be saved twice');
    await click('[data-preset-mode=fast] [data-preset-action=current]');
    await click('[data-preset-mode=fast] [data-preset-action=save]');
    await until('window.tierPresetFixture.saved().claudeFastPreset?.effort==="Extra"', 'independent fast preset saved');
    await click('[data-preset-mode=fast] [data-preset-action=current]');
    check(await js('document.querySelector("[data-preset-mode=fast] [data-preset-feedback]").textContent===window.tierPresetFixture.copy.presetCurrentMatchesSaved'), 'matching choice does not request another save');
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
      await js('document.querySelector("#tier-presets-title").scrollIntoView({block:"start"})'); await shot(state.step);
      if(zoom===2){await js('document.querySelector("[data-preset-mode=think]").scrollIntoView({block:"start"})');await shot(state.step+'-think');}
    }
    if (locale === 'en' && theme === 'light' && width === 720) {
      await click('.tier-presets-help summary');
      check(await js('document.querySelector(".tier-presets-help").open'), 'help opens through its summary');
      await js('document.querySelector(".tier-presets-help").scrollIntoView({block:"end"})'); await shot('en-light-help-narrow');
      await click('.tier-presets-help summary');
    }
    // IME Escape must not close settings; regular Escape remains available after save.
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true}))');
    check(await js('document.body.dataset.closed!=="true"'), 'IME escape does not leave settings');
    await click('[data-preset-mode=think] [data-preset-action=reset]');
    await until('window.tierPresetFixture.saved().claudeThinkPreset===null', 'recommendation restored');
    if (extra) {
      await click('[data-preset-mode=think] [data-preset-action=current]');
      await js('window.tierPresetFixture.hold()'); await click('[data-preset-mode=think] [data-preset-action=save]');
      await click('[data-settings-section=appearance]');
      await js('window.tierPresetFixture.release()');
      await until('window.tierPresetFixture.saved().claudeThinkPreset?.effort==="Extra"', 'hidden preset save finishes');
      check(await js('document.activeElement.id==="settings-category-appearance"'), 'hidden completion does not steal focus');
      await click('[data-settings-section=models]');
      check(await js('document.querySelector("[data-preset-mode=think] [data-preset-feedback]").textContent===window.tierPresetFixture.copy.presetSaved'), 'returning shows the tier result');
      await click('[data-preset-mode=think] [data-preset-action=reset]');
      await until('window.tierPresetFixture.saved().claudeThinkPreset===null', 'recommendation restored after category roundtrip');
    }
    // Native site selector and independent storage across all supported capability shapes.
    if (extra) {
      const sites = await js('window.tierPresetFixture.sites');
      for (const [index, site] of sites.entries()) {
        await js('document.querySelector("#tier-preset-site").focus()'); await key('Home');
        for (let i = 0; i < index; i++) await key('Down'); await key('Tab');
        await until(`document.querySelector('#${site}-think-model')!==null`, 'selected site fields');
        const before = await js('window.tierPresetFixture.saved()');
        await click('[data-preset-action=refresh]');
        await until(`document.querySelector('#${site}-think-model').options.length>1`, 'site choices loaded');
        await click('[data-preset-mode=think] [data-preset-action=current]');
        if (site === 'deepseek') {
          check(await js('document.querySelector("label[for=deepseek-think-model]").firstChild.textContent===window.tierPresetFixture.copy.presetFeature'), 'feature label');
          check(await js('[...document.querySelector("#deepseek-think-effort").options].some(o=>o.value==="Off"&&o.textContent===window.tierPresetFixture.copy.presetOff)'), 'toggle translated');
        }
        if (site === 'doubao') check(await js('document.querySelector("#doubao-think-effort")===null'), 'mode only has one selector');
        await click('[data-preset-mode=think] [data-preset-action=save]');
        await until(`JSON.stringify(window.tierPresetFixture.saved()['${site}ThinkPreset'])===JSON.stringify(window.tierPresetFixture.current['${site}'])`, 'site exact choice saved');
        const after = await js('window.tierPresetFixture.saved()');
        check(Object.keys(before).every(k=>k===`${site}ThinkPreset`||JSON.stringify(before[k])===JSON.stringify(after[k])), 'other sites and fast choice unchanged');
        if (['deepseek', 'doubao'].includes(site)) { await js('document.querySelector("#tier-presets-title").scrollIntoView({block:"start"})'); await shot(`en-light-${site}`); }
        await click('[data-preset-mode=think] [data-preset-action=reset]');
        await until(`window.tierPresetFixture.saved()['${site}ThinkPreset']===null`, 'site recommendation restored');
        report.sites.push(site);
      }
      // Unsaved site changes require a deliberate discard; Escape keeps the exact draft.
      await click('[data-preset-mode=think] [data-preset-action=current]');
      await js('document.querySelector("#tier-preset-site").focus()'); await key('Home'); await key('Tab');
      await until('document.querySelector(".confirm-dialog")!==null', 'dirty site switch confirmed');
      await key('Escape');
      check(await js('document.querySelector("#tier-preset-site").value==="chatglm"'), 'cancel keeps selected site');
      await js('document.querySelector("#tier-preset-site").focus()'); await key('Home'); await key('Tab');
      await until('document.querySelector(".confirm-dialog")!==null', 'discard dialog opened');
      await click('.confirm-actions .primary');
      await until('document.querySelector("#claude-think-model")!==null', 'discard switches site');
    }
    boundary(); report.cases.push({ ...value, ...geometry });
  }
  check(report.errors.length === 0, 'no renderer errors');
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  win.destroy(); app.quit();
}).catch(async error => {
  report.errors.push(String(error.message)); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (tools) await tools.failure(error); if (win && !win.isDestroyed()) win.destroy(); app.exit(1);
});
