const { app, BrowserWindow, nativeTheme, session } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
  .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1440, height: 1200, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  const errors = [], reports = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source);
  const paint = async () => {
    await run('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    await run('Promise.allSettled(document.getAnimations().map(animation=>animation.finished))');
    boundary();
  };
  const measure = () => run(`(() => {
    const selectors=['#normal','#notes','#readonly','#invalid','#disabled','.prompt-composer','#popover'];
    return {width:innerWidth,dpr:devicePixelRatio,contrast:matchMedia('(prefers-contrast: more)').matches,
      forced:matchMedia('(forced-colors: active)').matches,overflow:document.documentElement.scrollWidth>innerWidth+1,
      fields:selectors.map(selector=>{const node=document.querySelector(selector),style=getComputedStyle(node),r=node.getBoundingClientRect();
        return {selector,border:style.borderLeftColor,borderWidth:style.borderLeftWidth,borderStyle:style.borderLeftStyle,
          background:style.backgroundColor,shadow:style.boxShadow,opacity:style.opacity,outline:style.outlineStyle,
          left:r.left,top:r.top,right:r.right,bottom:r.bottom,height:r.height,readonly:node.readOnly??false,disabled:node.disabled??false};})};
  })()`);
  const pixelRatios = async geometry => {
    const image = await win.webContents.capturePage(), size = image.getSize(), bitmap = image.toBitmap();
    const scale = size.width / geometry.width;
    const pixel = (x, y) => {
      const offset = (Math.floor(y * scale) * size.width + Math.floor(x * scale)) * 4;
      return [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset]];
    };
    return geometry.fields.filter(field => field.selector !== '#disabled').map(field => {
      const y = (field.top + field.bottom) / 2;
      assert.equal(field.left >= 2 && field.bottom <= size.height / scale, true, `visible pixel target ${field.selector}`);
      const border = pixel(field.left + .5, y), outside = pixel(field.left - 3, y), inside = pixel(field.left + 4, field.top + 4);
      return { selector: field.selector, border, outside, inside, outsideRatio: contrast(border, outside), insideRatio: contrast(border, inside) };
    });
  };
  const scenarios = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const density of ['compact', 'comfortable'])
    for (const theme of ['light', 'dark']) for (const zoom of [1, 2]) scenarios.push({ locale, density, theme, zoom, preference: 'default' });
  for (const preference of ['contrast', 'forced-colors']) for (const theme of ['light', 'dark']) for (const zoom of [1, 2])
    scenarios.push({ locale: 'en', density: 'comfortable', theme, zoom, preference });
  for (const scenario of scenarios) {
    const { locale, density, theme, zoom, preference } = scenario;
    console.log(`Input boundary scenario: ${locale}/${density}/${theme}/${zoom}/${preference}`);
    nativeTheme.themeSource = theme;
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    await win.loadFile(join(output, 'index.html'), { query: { locale, density } });
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-contrast', value: preference === 'contrast' ? 'more' : 'no-preference' },
      { name: 'forced-colors', value: preference === 'forced-colors' ? 'active' : 'none' }
    ] });
    win.webContents.setZoomFactor(zoom); await paint();
    const geometry = await measure();
    assert.equal(geometry.contrast, preference === 'contrast'); assert.equal(geometry.forced, preference === 'forced-colors');
    assert.equal(Math.abs(geometry.width - 1440 / zoom) <= 1, true, 'actual zoom viewport');
    assert.equal(geometry.overflow, false, 'input state fixture has no horizontal overflow');
    for (const field of geometry.fields) {
      assert.equal(field.borderWidth, '1px', `${field.selector}: boundary width`);
      assert.equal(field.borderStyle, 'solid', `${field.selector}: boundary style`);
      assert.equal(field.left >= 0 && field.right <= geometry.width, true, `${field.selector}: fits viewport`);
    }
    const pixels = await pixelRatios(geometry);
    for (const field of pixels) {
      assert.equal(field.outsideRatio >= 3, true, `${theme}/${preference}/${field.selector}: outer boundary ${field.outsideRatio}`);
      assert.equal(field.insideRatio >= 3, true, `${theme}/${preference}/${field.selector}: inner boundary ${field.insideRatio}`);
    }
    const state = Object.fromEntries(geometry.fields.map(field => [field.selector, field]));
    assert.equal(state['#readonly'].readonly, true);
    assert.equal(state['#disabled'].disabled, true);
    assert.equal(state['#disabled'].opacity, preference === 'forced-colors' ? '1' : '0.55');
    if (preference !== 'forced-colors') assert.equal(state['#invalid'].border === state['#normal'].border, false, 'invalid state keeps its semantic border');
    await run('document.querySelector("#normal").focus()'); await paint();
    const focus = (await measure()).fields[0];
    assert.equal(preference === 'forced-colors' ? focus.outline === 'solid' : focus.shadow.includes('inset'), true, 'focus indicator remains visible');
    if (locale === 'en' && density === 'comfortable' && zoom === 2 && preference === 'default')
      writeFileSync(join(output, `fields-${theme}-input-focus-200.png`), (await win.webContents.capturePage()).toPNG());
    await run('document.querySelector("#invalid").focus()'); await paint();
    const invalidFocus = (await measure()).fields.find(field => field.selector === '#invalid');
    assert.equal(invalidFocus.border, state['#invalid'].border, 'focus retains error boundary');
    await run('document.querySelector("[name=prompt]").focus()'); await paint();
    const composer = (await measure()).fields.find(field => field.selector === '.prompt-composer');
    assert.equal(preference === 'forced-colors' ? composer.outline === 'solid' : composer.shadow.includes('inset'), true, 'composer owns its focus indicator');
    if (locale === 'en' && density === 'comfortable' && zoom === 2 && preference === 'default')
      writeFileSync(join(output, `fields-${theme}-composer-focus-200.png`), (await win.webContents.capturePage()).toPNG());
    const promptStyle = await run('(()=>{const s=getComputedStyle(document.querySelector("[name=prompt]"));return {outline:s.outlineStyle,shadow:s.boxShadow,borderWidth:s.borderLeftWidth};})()');
    assert.equal(promptStyle.outline, 'none'); assert.equal(promptStyle.shadow, 'none', 'no second textarea focus indicator');
    if (preference === 'forced-colors') assert.equal(promptStyle.borderWidth, '0px', 'system colors do not add a second textarea boundary');
    await run('document.activeElement.blur()'); await paint();
    if (locale === 'en' && density === 'comfortable') writeFileSync(join(output, `fields-${theme}-${preference}-${zoom * 100}.png`), (await win.webContents.capturePage()).toPNG());
    reports.push({ ...scenario, geometry, pixels, focus, invalidFocus, composer });
  }
  for (const type of ['', 'text', 'search', 'email', 'password', 'url', 'tel', 'number']) {
    assert.equal(await run(`(()=>{const node=document.querySelector('#normal');${type ? `node.type=${JSON.stringify(type)}` : "node.removeAttribute('type')"};return getComputedStyle(node).borderLeftStyle==='solid';})()`), true, `text entry type ${type || 'default'} is bounded`);
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'fields-report.json'), JSON.stringify(reports, null, 2));
  boundary(); win.webContents.debugger.detach(); win.destroy(); app.quit();
  console.log(`Native input boundaries passed: ${reports.length} rendered locale/density/theme/zoom/preference groups.`);
}).catch(error => { writeFileSync(join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2)); console.error(error); app.exit(1); });
