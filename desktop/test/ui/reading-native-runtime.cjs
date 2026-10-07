const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const { nativePerformance } = require('./native-performance.cjs');
const output = process.argv[2], suite = process.argv[3], only = process.argv[4] || '';
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
let tools;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1200, height: 960, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  const state = { scenario: 'startup', step: 'load', lastInput: null };
  tools = nativeReadingTools(win, output, state);
  const { js, check, until, click } = tools;
  check(!only || (suite === 'comparison' && ['comparison-focus-and-scroll', 'literal-worksheet-and-decision', 'raw-follow-up-and-source-boundaries'].includes(only)), 'known diagnostic scenario');
  const mark = async (expression, name = 'target') => {
    await js(`(()=>{document.querySelectorAll('[data-native-target]').forEach(node=>node.removeAttribute('data-native-target'));
      const node=${expression};if(!node)throw new Error('missing_native_target');node.setAttribute('data-native-target',${JSON.stringify(name)});})()`);
    return `[data-native-target=${JSON.stringify(name)}]`;
  };
  const label = (key, scope = 'document') => mark(`[...${scope}.querySelectorAll('button')].find(node=>node.textContent.trim()===window.readingFixture.labels.${key})`);
  const choose = async (selector, key) => {
    await click(selector);
    await click(await mark(`[...document.querySelectorAll('[role=option]')].find(node=>node.querySelector('span')?.textContent===window.readingFixture.siteLabel(${JSON.stringify(key)})&&node.getAttribute('aria-disabled')!=='true')`));
  };
  const view = async name => click(`.library-view-switch button:nth-child(${name === 'read' ? 1 : name === 'compare' ? 2 : 3})`);
  const open = async (mode = suite === 'comparison' ? 'comparison' : 'analysis', locale = 'en', width = 1200, zoom = 1, forced = false, theme = 'light') => {
    const ready = nativePerformance(app, `${suite}:${mode}:${locale}:${width}:${zoom}:load-to-ready`);
    state.step = 'load'; win.webContents.setZoomFactor(1); win.setContentSize(width, 960); nativeTheme.themeSource = theme;
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    await win.loadFile(join(output, 'index.html'), { query: { locale, mode } });
    win.webContents.setZoomFactor(zoom);
    if (forced) { win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); }
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await until(`Math.abs(innerWidth-${width / zoom})<=1&&!!document.querySelector('.archive-detail')`, 'saved record and zoom');
    await until(`document.querySelector('.archive-detail').dataset.view===${JSON.stringify(mode === 'comparison' ? 'compare' : 'read')}`, 'initial reading view');
    samples.push(ready());
    writeFileSync(join(output, 'performance.json'), JSON.stringify(samples, null, 2));
  };
  const report = [], geometry = [], clipboard = [], samples = [];
  const finish = name => { report.push({ scenario: name, ok: true }); console.log(JSON.stringify({ scenario: name, ok: true })); };
  const snapshot = async name => { const value = await tools.geometry(name); check(!value.overflow && !value.controlOverflow, `${name}: horizontal containment`);
    geometry.push(value); writeFileSync(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
    writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const cases = ['en', 'zh-CN', 'zh-TW'].flatMap(locale => ['light', 'dark'].flatMap(theme => [1200, 640].map(width => ({ locale, theme, width, zoom: 1, forced: false }))));
  cases.push({ locale: 'en', theme: 'light', width: 960, zoom: 1.5, forced: false }, { locale: 'zh-TW', theme: 'light', width: 1200, zoom: 1, forced: true });
  const run = require(suite === 'comparison' ? './comparison-native-scenarios.cjs' : './analysis-native-scenarios.cjs');
  await run({ ...tools, win, state, output, open, label, mark, choose, view, finish, snapshot, cases, clipboard, only });
  check(only ? report.length === 1 && geometry.length === 0 : report.length === 4 && geometry.length === 14, 'complete native scenarios and layout matrix');
  writeFileSync(join(output, 'report.json'), JSON.stringify({ report, geometry, clipboard, samples, diagnostic: !!only }, null, 2));
  win.destroy(); app.exit(0);
}).catch(async error => {
  if (tools) await tools.failure(error);
  console.error(String(error.message).replace(/\s+/g, ' ').slice(0, 200)); app.exit(1);
});
