const { nativeTheme } = require('electron');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

module.exports = async ({ app, win, state, output, js, check, until, key, click, geometry }) => {
  const failures = [], capture = [], keyboard = [], layouts = [], resources = [];
  const expect = (value, message) => { if (!value) failures.push(message); };
  const resourceBoundary = () => {
    if (process.platform !== 'linux') return;
    const seen = new Set();
    const visit = pid => {
      if (seen.has(String(pid))) return [];
      seen.add(String(pid));
      try {
        const group = readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim().replace(/^0::/, '');
        const children = readdirSync(`/proc/${pid}/task`).flatMap(tid => {
          try { return readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean); }
          catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return []; throw error; }
        });
        return [{ pid, group }, ...[...new Set(children)].flatMap(visit)];
      } catch (error) {
        if (['ENOENT', 'ESRCH'].includes(error.code)) return [];
        throw error;
      }
    };
    const processes = [process.pid, ...app.getAppMetrics().map(item => item.pid)].flatMap(visit);
    let common = processes[0]?.group || '/';
    while (common !== '/' && !processes.every(item => item.group === common || item.group.startsWith(`${common}/`))) common = dirname(common);
    for (let group = common; group !== '/'; group = dirname(group)) {
      const memory = readFileSync(`/sys/fs/cgroup${group}/memory.max`, 'utf8').trim();
      const swap = readFileSync(`/sys/fs/cgroup${group}/memory.swap.max`, 'utf8').trim();
      if (Number(memory) <= 4 * 1024 ** 3 && Number(swap) <= 512 * 1024 ** 2) {
        resources.push({ group, memory, swap, processes });
        writeFileSync(join(output, 'process-boundary.json'), JSON.stringify(resources, null, 2)); return;
      }
    }
    throw new Error('Observed Electron process tree has no common 4GiB/512MiB cgroup boundary');
  };
  resourceBoundary();
  const measure = index => js(`(() => {const columns=[...document.querySelectorAll('.archive-compare-column')],node=columns[${index}],s=getComputedStyle(node);
    return {active:document.activeElement===node,top:node.scrollTop,other:columns[1-${index}].scrollTop,
      focus:node.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2,
      name:node.getAttribute('aria-label'),height:node.clientHeight,total:node.scrollHeight};})()`);
  const focusPicker = index => js(`document.querySelectorAll('.archive-compare-picker [role=combobox]')[${index}].focus()`);
  const settle = async index => {
    let before = -1, stable = 0;
    for (let round = 0; round < 30 && stable < 3; round++) {
      await js('new Promise(resolve=>setTimeout(resolve,30))');
      const value = (await measure(index)).top; stable = value === before ? stable + 1 : 0; before = value;
    }
  };
  const cases = ['en', 'zh-CN', 'zh-TW'].flatMap(locale => ['light', 'dark'].flatMap(theme => [1, 2].map(zoom => ({ locale, theme, zoom, forced: false }))));
  cases.push({ locale: 'en', theme: 'light', zoom: 1, forced: true });
  for (const sample of cases) {
    const { locale, theme, zoom, forced } = sample, name = `${locale}-${theme}-${zoom}-${forced ? 'forced' : 'normal'}`;
    state.scenario = name; state.step = 'load';
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(1440, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, mode: 'comparison' } });
    win.webContents.setZoomFactor(zoom); win.webContents.debugger.attach('1.3');
    if (forced) await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await until(`Math.abs(innerWidth-${1440 / zoom})<=1&&document.querySelectorAll('.archive-compare-column').length===2`, 'comparison and zoom');
    await js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    resourceBoundary();
    state.step = 'capture-name';
    const expectedName = await js(`(() => {const label=window.readingFixture.labels.captureArchive;
      [...document.querySelectorAll('.library-toolbar-actions button')].find(node=>node.querySelector('span')?.textContent===label).dataset.captureProbe='true';return label;})()`);
    const document = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const target = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: '[data-capture-probe]' });
    const tree = await win.webContents.debugger.sendCommand('Accessibility.getPartialAXTree', { nodeId: target.nodeId });
    const axName = tree.nodes.find(node => node.role?.value === 'button')?.name?.value ?? '';
    const title = await js('document.querySelector("[data-capture-probe]").title');
    expect(axName === expectedName && title === expectedName, `${name}: capture retains localized AX name and tooltip`);
    capture.push({ name, axName, title, expectedName });
    state.step = 'keyboard-reading';
    for (const index of [0, 1]) {
      await focusPicker(index); const before = await measure(index); await key('Tab'); const entered = await measure(index);
      expect(entered.active && entered.focus && Math.abs(entered.top - before.top) <= 1, `${name}/${index}: Tab enters the visible reading region without jumping`);
      const source = index === 0 ? '[S1] Claude' : '[S2] ChatGPT';
      expect(entered.name === source, `${name}/${index}: reading region names its source`);
      keyboard.push({ name, index, before, entered });
      if (index === 0) writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      if (!entered.active) continue;
      await key('Down'); await until(`document.querySelectorAll('.archive-compare-column')[${index}].scrollTop>${entered.top}`, 'arrow scroll'); await settle(index);
      const arrow = await measure(index); await key('PageDown'); await settle(index); const page = await measure(index);
      expect(page.top > arrow.top && page.other === before.other, `${name}/${index}: keyboard scroll stays in its answer column`);
      await focusPicker(index); await key('Tab'); const reentered = await measure(index);
      expect(reentered.active && Math.abs(reentered.top - page.top) <= 1, `${name}/${index}: returning preserves the reading position`);
      await key('Tab'); expect(await js(`document.activeElement===document.querySelectorAll('.archive-compare-column')[${index}].querySelector('.answer-excerpt-open')`), `${name}/${index}: excerpt remains reachable after reading`);
      await key('Tab', ['shift']); await key('Tab', ['shift']);
      expect(await js(`document.activeElement===document.querySelectorAll('.archive-compare-picker [role=combobox]')[${index}]`), `${name}/${index}: Shift+Tab returns to its source picker`);
      keyboard.at(-1).scroll = { arrow, page, reentered };
    }
    if (locale === 'en' && theme === 'light' && zoom === 1 && !forced) {
      await click('.archive-compare-picker [role=combobox]'); await click('.library-options [role=option]:nth-child(3)');
      await key('Tab'); expect((await measure(0)).name === '[S3] Gemini', 'reading name follows the selected source');
    }
    const layout = await geometry(name); layouts.push(layout);
    expect(!layout.overflow && !layout.controlOverflow, `${name}: controls remain within the viewport`);
  }
  resourceBoundary();
  const report = [{ scenario: 'capture-accessible-name', ok: capture.every(item => item.axName === item.expectedName && item.title === item.expectedName) },
    { scenario: 'comparison-keyboard-reading', ok: !failures.some(message => !message.includes('capture retains')) }];
  writeFileSync(join(output, 'report.json'), JSON.stringify({ report, geometry: layouts, capture, keyboard, failures, resources }, null, 2));
  console.log(JSON.stringify({ report, failures })); check(!failures.length, 'reading accessibility regression; see report.json');
};
