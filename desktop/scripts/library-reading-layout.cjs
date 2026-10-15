const assert = require('node:assert/strict');

const paint = run => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

async function reading(run) {
  const metrics = await run(`(() => {
    const answer = document.querySelector('.archive-answer');
    const body = answer.querySelector('.markdown-preview');
    const actions = [...answer.querySelectorAll(':scope > header button, :scope > button')];
    const boxes = actions.map(button => button.getBoundingClientRect());
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.font = getComputedStyle(body).font;
    const prose = [...body.querySelectorAll(':scope > p, :scope > ul, :scope > ol, :scope > blockquote')];
    const h5 = getComputedStyle(body.querySelector('h5')), h6 = getComputedStyle(body.querySelector('h6'));
    return {
      typography: { measure: canvas.measureText('0').width * 75, bodyWidth: body.clientWidth,
        proseWidths: prose.map(node => node.getBoundingClientRect().width),
        proseContained: prose.every(node => node.scrollWidth <= node.clientWidth + 1),
        fullEnglish: prose.some(node => node.textContent.startsWith('A saved answer') && node.textContent.endsWith('losing your place.')),
        headingWeights: [h5.fontWeight, h6.fontWeight], headingSizes: [h5.fontSize, h6.fontSize],
        tableWidth: body.querySelector('.markdown-table').getBoundingClientRect().width,
        codeWidth: body.querySelector('.markdown-code').getBoundingClientRect().width },
      firstMargin: parseFloat(getComputedStyle(body.firstElementChild).marginTop),
      lastMargin: parseFloat(getComputedStyle(body.lastElementChild).marginBottom),
      leading: body.firstElementChild.getBoundingClientRect().top - Math.max(...boxes.map(box => box.bottom)),
      actionSpread: Math.max(...boxes.map(box => box.top)) - Math.min(...boxes.map(box => box.top))
    };
  })()`);
  await run('document.querySelector(".archive-detail-pane").scrollTop = 800');
  await paint(run);
  const sticky = await run(`(() => {
    const views = document.querySelector('.library-view-switch').getBoundingClientRect();
    const pane = document.querySelector('.archive-detail-pane');
    const group = document.querySelector('.library-reading-navigation').getBoundingClientRect();
    return { navigationGap: document.querySelector('.archive-answer-nav').getBoundingClientRect().top - views.bottom,
      stickyGap: group.top - pane.getBoundingClientRect().top, scroll: pane.scrollTop };
  })()`);
  Object.assign(metrics, sticky);
  await run('document.querySelector(".archive-detail-pane").scrollTop = 0');
  await paint(run);
  const problems = [];
  const type = metrics.typography;
  if (!type.fullEnglish || !type.proseContained || type.proseWidths.some(width => width > type.measure + 1)) problems.push('prose exceeds its reading measure or loses content');
  if (Math.abs(type.tableWidth - type.bodyWidth) > 1 || Math.abs(type.codeWidth - type.bodyWidth) > 1) problems.push('technical blocks lose available width');
  if (type.headingSizes.some(size => size !== '16px') || Number(type.headingWeights[0]) <= Number(type.headingWeights[1])) problems.push('deep headings lose their weight hierarchy');
  if (metrics.firstMargin !== 0 || metrics.lastMargin !== 0) problems.push('body edges add paragraph spacing');
  if (metrics.leading < 12 || metrics.leading > 20) problems.push('source actions and body lose their reading rhythm');
  if (metrics.actionSpread > 1) problems.push('related source actions occupy separate rows despite available room');
  if (metrics.navigationGap < -1) problems.push('sticky source navigation is covered by the reading tabs');
  if (metrics.scroll < 700 || Math.abs(metrics.stickyGap) > 1) problems.push('reading navigation must stay at the scroller edge');
  assert.equal(problems.length, 0, `${problems.join('; ')}: ${JSON.stringify(metrics)}`);
  return metrics;
}

async function comparison(run) {
  const metrics = await run(`(() => [...document.querySelectorAll('.archive-compare-paragraph .markdown-preview')].map(body => ({
    firstMargin: parseFloat(getComputedStyle(body.firstElementChild).marginTop),
    lastMargin: parseFloat(getComputedStyle(body.lastElementChild).marginBottom)
  })))()`);
  assert.ok(metrics.length > 4, 'comparison includes multiple kinds of Markdown blocks');
  assert.ok(metrics.every(item => item.firstMargin === 0 && item.lastMargin === 0),
    `comparison blocks must not repeat their internal paragraph margins: ${JSON.stringify(metrics)}`);
  return { blocks: metrics.length, edges: 'contained' };
}

async function anchors({ win, nativeTheme, output, run, wait, click, key, shot }) {
  const reports = [];
  for (const [locale, width, zoom, theme] of [
    ['zh-CN', 1600, 1, 'light'], ['en', 780, 1, 'light'],
    ['zh-TW', 960, 1.25, 'dark'], ['en', 960, 1.5, 'dark'], ['en', 1280, 2, 'light']
  ]) {
    win.webContents.setZoomFactor(1); win.setContentSize(width, 900); nativeTheme.themeSource = theme;
    await win.loadFile(require('node:path').join(output, 'index.html'), { query: { locale, longCode: '1' } });
    win.webContents.setZoomFactor(zoom);
    await wait(`Math.abs(innerWidth-${width / zoom}) <= 1 && !!document.querySelector('.archive-answer h2')`);
    await paint(run);
    await click('.archive-answer-nav a:last-child');
    const geometry = await run(`(() => {
      const pane = document.querySelector('.archive-detail-pane'), nav = document.querySelector('.library-reading-navigation');
      const target = document.querySelector('#archive-answer-8'), pre = [...target.querySelectorAll('pre')].at(-1);
      return { targetTop: target.getBoundingClientRect().top, navigationBottom: nav.getBoundingClientRect().bottom,
        height: nav.getBoundingClientRect().height, viewport: innerWidth, width: target.clientWidth, scroll: target.scrollWidth,
        paneBottom: pane.getBoundingClientRect().bottom, hash: location.hash,
        line: pre.textContent, codeWidth: pre.clientWidth, codeScroll: pre.scrollWidth };
    })()`);
    assert.ok(geometry.hash === '#archive-answer-8' && geometry.targetTop >= geometry.navigationBottom - 1 && geometry.targetTop < geometry.paneBottom - 16,
      `source target clears variable navigation and is visible: ${JSON.stringify({ ...geometry, line: undefined })}`);
    assert.ok(geometry.scroll <= geometry.width + 1, 'long code stays inside the answer');
    assert.ok(geometry.line.includes('unbroken_'.repeat(250)) && geometry.codeScroll > geometry.codeWidth, 'full long code scrolls within its own block');
    await key('Tab');
    const focus = await run(`(() => {
      const active = document.activeElement, pane = document.querySelector('.archive-detail-pane').getBoundingClientRect();
      const nav = document.querySelector('.library-reading-navigation').getBoundingClientRect(), box = active.getBoundingClientRect();
      return { action: !!active.closest('.archive-answer-actions'), source: active.closest('.archive-answer')?.id,
        top: box.top, bottom: box.bottom, navBottom: nav.bottom, paneBottom: pane.bottom };
    })()`);
    assert.ok(focus.action && focus.source === 'archive-answer-8' && focus.top >= focus.navBottom - 1 && focus.bottom <= focus.paneBottom + 1,
      `keyboard focus remains visible below navigation: ${JSON.stringify(focus)}`);
    if (zoom === 1.25) await shot('reading-navigation-zoom-125');
    const bookmark = await require('./library-best-navigation.cjs')({ win, run, wait, click, key, shot, locale, theme, zoom });
    reports.push({ locale, windowWidth: width, zoom, theme, ...geometry, line: undefined, focus, bookmark });
  }
  win.webContents.setZoomFactor(1); win.setContentSize(1600, 1000); nativeTheme.themeSource = 'light';
  await win.loadFile(require('node:path').join(output, 'index.html'));
  await wait('!!document.querySelector(".archive-detail h1")');
  return reports;
}

module.exports = { reading, comparison, anchors };
