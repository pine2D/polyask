const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1600, height: 1000, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  const errors = [], reports = [], failures = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source);
  const paint = () => run('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  const wait = async source => {
    const deadline = Date.now() + 5000;
    while (!(await run(source))) {
      if (Date.now() >= deadline) throw new Error(`UI wait timed out: ${source}`);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  const shot = async name => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await paint();
      const image = await win.webContents.capturePage();
      const pixels = image.toBitmap(), background = pixels.readUInt32LE(0) & 0xffffff;
      for (let offset = 0; offset + 4 <= pixels.length; offset += 64) {
        if ((pixels.readUInt32LE(offset) & 0xffffff) !== background) {
          writeFileSync(join(output, `${name}.png`), image.toPNG()); return;
        }
      }
    }
    throw new Error(`Blank screenshot: ${name}`);
  };
  const check = (ok, message) => { if (!ok) failures.push(message); };
  await require('./interface-polish-visual.cjs')({ win, output, run, wait, paint, shot });
  const measure = () => run(`(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const selectors = ['.command-bar', '.command-bar > *', '.page-tabs button', '.scope-split', '.settings-card', '.settings-actions', '.sync-stage-list', '.workspace-drawer'];
    const boxes = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map(e => {
      const r = e.getBoundingClientRect();
      return {selector, width:e.clientWidth, scroll:e.scrollWidth, left:r.left, right:r.right, top:r.top, bottom:r.bottom};
    }));
    const luminance = rgb => rgb.map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;})
      .reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0);
    const ratios = [...document.querySelectorAll('.send, .settings-actions .primary, .site-state')].filter(e => !e.disabled).map(e => {
      const s = getComputedStyle(e), parse = c => c.match(/[\\d.]+/g).slice(0,3).map(Number);
      const background = e.matches('.site-state') ? getComputedStyle(e.closest('.tile-frame')).backgroundColor : s.backgroundColor;
      const a = luminance(parse(s.color)), b = luminance(parse(background));
      return {selector:e.className, ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
    return {boxes, ratios, viewport:innerWidth, height:document.querySelector('.command-bar')?.getBoundingClientRect().height,
      textSize:[...document.querySelectorAll('.sync-state span,.sync-privacy,.preference-card small,.danger-zone label,.sync-stage-list small')].map(e => parseFloat(getComputedStyle(e).fontSize))};
  })()`);
  for (const surface of ['shell', 'settings']) for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    for (const theme of ['light', 'dark']) for (const density of ['compact', 'comfortable']) {
      nativeTheme.themeSource = theme;
      for (const width of surface === 'shell' ? [960, 1101, 1280, 1401, 1600] : [960, 1280, 1600]) {
        win.setContentSize(width, 900);
        await win.loadFile(join(output, 'index.html'), { query: { surface, locale, density, stress: [960, 1101, 1401].includes(width) && surface === 'shell' ? '1' : '0' } });
        await wait('!!document.querySelector(".command-bar,.settings-workspace")');
        await paint();
        const label = `${surface}/${locale}/${theme}/${density}/${width}`, result = await measure();
        for (const box of result.boxes) {
          check(box.scroll <= box.width + 2, `${label}: overflow ${JSON.stringify(box)}`);
          check(box.left >= -1 && box.right <= result.viewport + 1, `${label}: offscreen ${JSON.stringify(box)}`);
          if (box.selector === '.command-bar > *') check(box.top >= 0 && box.bottom <= result.height + 1, `${label}: toolbar wraps`);
        }
        for (const color of result.ratios) check(color.ratio >= 4.5, `${label}: ${color.selector} text contrast ${color.ratio.toFixed(2)}`);
        if (surface === 'shell') check(result.height === (density === 'compact' ? 52 : 64), `${label}: native bounds mismatch`);
        else check(result.textSize.every(size => size >= 12), `${label}: secondary text below 12px`);
        reports.push({ label, ...result });
        if (locale === 'zh-CN' && density === 'compact' && width === 1600) await shot(`${surface}-${theme}`);
        if (surface === 'shell' && locale === 'en' && density === 'comfortable' && width === 960) await shot(`shell-stress-${theme}`);
      }
    }
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ reports, failures }, null, 2));
  // Keyboard interaction proves resizing preserves the production composer contract.
  await win.loadFile(join(output, 'index.html'), { query: { surface: 'shell' } });
  await wait('!!document.querySelector("textarea")');
  await run('document.querySelector("textarea").focus()');
  await wait('document.querySelector(".command-bar").classList.contains("is-expanded")');
  check((await measure()).height === 120, 'expanded composer native bounds mismatch');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] });
  await wait('document.querySelector(".app-shell").dataset.sent === "true"');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait('!document.querySelector(".command-bar").classList.contains("is-expanded")');
  await run('document.querySelector(".tile-header button").focus()');
  check(await run('getComputedStyle(document.activeElement).outlineStyle !== "none" && parseFloat(getComputedStyle(document.activeElement).outlineOffset) < 0'), 'tile action focus must stay inside the clipped header');
  await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale: 'en' } });
  await wait('!!document.querySelector(".settings-workspace")');
  await run('document.querySelector("#sync-diagnostics-toggle").focus()');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await wait('!!document.querySelector(".sync-stage-list")');
  win.webContents.setZoomFactor(1.5);
  await paint();
  const zoom = await measure();
  for (const box of zoom.boxes) check(box.scroll <= box.width + 2 && box.right <= zoom.viewport + 1, `150% settings overflow: ${JSON.stringify(box)}`);
  check(zoom.textSize.every(size => size >= 12), 'expanded diagnostics text below 12px');
  await shot('settings-zoom');
  await require('./native-feel-visual.cjs')({ win, output, run, wait, paint, shot });
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ reports, failures }, null, 2));
  if (failures.length) { console.error(failures.slice(0, 16).join('\n')); throw new Error(`${failures.length} UI checks failed`); }
  console.log(`Shell UI passed: ${reports.length} layout variants, action/status contrast, composer and diagnostics keyboard flow, 150% settings zoom.`);
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
