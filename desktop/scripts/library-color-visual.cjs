const assert = require('node:assert/strict');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

// 在 Chromium 中解析实际颜色（含 color-mix / 系统色），只传回标量。
function measureColors() {
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const root = getComputedStyle(document.documentElement);
  const rgb = color => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = color => color.map(value => {
    value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => {
    const values = [luminance(rgb(a)), luminance(rgb(b))];
    return (Math.max(...values) + .05) / (Math.min(...values) + .05);
  };
  const current = document.querySelector('.library-content-row:has([aria-current=true])');
  const style = getComputedStyle(current), outer = getComputedStyle(current.closest('.folder-content-list')).backgroundColor;
  const roles = { draft: '--muted', verify: '--warning-ink', final: '--success-ink' };
  return {
    selection: { boundary: ratio(style.borderTopColor, outer), inner: ratio(style.borderTopColor, style.backgroundColor),
      background: style.backgroundColor, outer, border: style.borderTopStyle, current: !!current.querySelector('[aria-current=true]'),
      hovered: current.matches(':hover') },
    badges: [...document.querySelectorAll('.library-status-badge')].map(node => {
      const s = getComputedStyle(node), status = node.dataset.status;
      return { status, text: node.textContent, color: rgb(s.color).join(','), background: s.backgroundColor,
        expected: rgb(root.getPropertyValue(roles[status])).join(','), ratio: ratio(s.color, s.backgroundColor),
        outline: parseFloat(s.outlineWidth), outlineStyle: s.outlineStyle, reading: !!node.closest('.decision-meta') };
    }),
    manual: document.querySelector('.decision-meta p')?.textContent,
    media: { contrast: matchMedia('(prefers-contrast: more)').matches, forced: matchMedia('(forced-colors: active)').matches },
    overflow: [...document.querySelectorAll('.folder-content-list, .decision-editor')].some(node => node.scrollWidth > node.clientWidth + 1)
  };
}

module.exports = async ({ win, nativeTheme, output, run, wait, click, shot }) => {
  const reports = [], simulations = [];
  const measure = () => run(`(${measureColors.toString()})()`);
  const checkSelection = metrics => {
    assert.ok(metrics.selection.current && metrics.selection.border === 'solid' && metrics.selection.boundary >= 3 && metrics.selection.inner >= 3,
      `current record needs a visible boundary on both surfaces: ${JSON.stringify(metrics.selection)}`);
  };
  const checkBadges = metrics => {
    assert.equal(metrics.badges.length, 4, 'all three list states and the reading state retain text labels');
    for (const badge of metrics.badges) assert.ok(badge.text.trim() && badge.ratio >= 4.5 && badge.color === badge.expected,
      `status keeps its role and readable text: ${JSON.stringify(badge)}`);
    assert.ok(metrics.manual.length > 10 && !metrics.overflow, 'manual-judgment explanation and contained layout remain available');
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(1280, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale, colorStates: '1' } });
    await wait('!!document.querySelector(".archive-detail h1") && !!document.querySelector(".archive-list[aria-busy=false] [aria-current=true]")');
    checkSelection(await measure());
    await click('.library-segments button:nth-child(3)');
    await wait('document.querySelectorAll(".archive-list .library-status-badge").length === 3');
    const states = [], modes = [];
    for (const status of ['draft', 'verify', 'final']) {
      const selector = `.archive-list button:has(.library-status-badge[data-status=${status}])`;
      await click(selector);
      await wait(`document.querySelector('.decision-meta [data-status=${status}]') !== null`);
      const point = await run(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      const metrics = await measure(); checkSelection(metrics); checkBadges(metrics);
      assert.ok(metrics.selection.hovered && !metrics.media.contrast && !metrics.media.forced, 'hovered selection is measured under the actual normal theme');
      assert.equal(new Set(metrics.badges.map(badge => badge.color)).size, 3, 'workflow states have distinct color roles');
      states.push({ status, ...metrics });
    }
    assert.equal(await run('window.libraryTest.writes'), 0, 'color and navigation never promote or save a decision');
    if (locale === 'zh-CN') await shot(`color-status-${theme}`);
    win.webContents.debugger.attach('1.3');
    try {
      if (locale === 'en') for (const type of ['protanopia', 'deuteranopia', 'tritanopia']) {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', { type });
        await shot(`color-${type}-${theme}`); simulations.push({ type, theme });
      }
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
      for (const features of [[{ name: 'prefers-contrast', value: 'more' }], [{ name: 'forced-colors', value: 'active' }]]) {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features });
        await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const metrics = await measure(); checkSelection(metrics); checkBadges(metrics);
        assert.equal(features[0].name === 'forced-colors' ? metrics.media.forced : metrics.media.contrast, true, 'requested contrast media is active');
        assert.ok(metrics.badges.every(badge => badge.outlineStyle === 'solid' && badge.outline >= 1), 'contrast modes draw a visible badge outline and text');
        modes.push({ feature: features[0].name, ...metrics });
        if (locale === 'en') await shot(`color-${features[0].name}-${theme}`);
      }
    } finally {
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      win.webContents.debugger.detach();
    }
    reports.push({ locale, theme, states, modes });
  }
  console.log(`Library colors passed: ${reports.length} theme/language groups, three workflow states, contrast modes and ${simulations.length} vision simulations.`);
  writeFileSync(join(output, 'color-report.json'), JSON.stringify({ reports, simulations }, null, 2));
  return { reports, simulations };
};
