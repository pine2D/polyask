// 用生产组件的真实几何验证空间预算，不依赖 CSS 字符串或截图像素相等。
exports.checkReadingGrid = async ({ open, run, click, wait, shot, paint, check, flows, win }) => {
  const samples = [];
  const geometry = () => run(`(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect();
    const textStart = selector => {
      const node = document.querySelector(selector), range = document.createRange();
      range.selectNodeContents(node); return range.getBoundingClientRect().left;
    };
    const inputStart = selector => {
      const input = document.querySelector(selector), css = getComputedStyle(input);
      return input.getBoundingClientRect().left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    };
    const library = !!document.querySelector('.library'), list = box(library ? '.folder-content-list' : '.question-browser');
    const page = box('.reading-page'), scroll = document.querySelector(library ? '.archive-detail-pane' : '.question-reader');
    return { viewport: innerWidth, container: box(library ? '.library' : '.question-history').width,
      sidebar: box('.folder-sidebar')?.width || 0, list: list.width, page: page?.width || 0,
      detail: box(library ? '.folder-detail' : '.question-reader')?.width || 0,
      overflow: scroll ? scroll.scrollWidth - scroll.clientWidth : 0,
      starts: list.width ? {
        search: inputStart(library ? '.folder-filters input[type=search]' : '.question-search input'),
        title: textStart(library ? '.library-item-title' : '.question-title'),
        date: textStart(library ? '.library-item-meta time' : '.question-main time'),
        group: library ? null : textStart('.question-day')
      } : null,
      folderStarts: library && box('.folder-sidebar').width ? {
        search: inputStart('.folder-sidebar input'), title: textStart('.folder-sidebar strong'),
        item: textStart('.library-folder-name')
      } : null
    };
  })()`);
  const aligned = (values, label) => {
    if (!values) return;
    const positions = Object.values(values).filter(value => value !== null);
    check(Math.max(...positions) - Math.min(...positions) <= 1, label + ': related text shares one key line ' + JSON.stringify(values));
  };
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const theme of ['light', 'dark']) for (const density of ['compact', 'comfortable']) {
    for (const width of [1319, 1320, 1366]) {
      const label = [locale, theme, density, width].join('-');
      await open('library', locale, theme, width, 800, 1, '', density);
      const result = await geometry();
      check((result.sidebar > 0) === (width >= 1320), label + ': show folders when the three-pane budget fits');
      check(result.list >= 280 && result.page >= 819 && result.overflow <= 1, label + ': navigation preserves a full reading column');
      aligned(result.starts, label); aligned(result.folderStarts, label + '-folders');
      samples.push({ label, ...result });
      if (locale === 'zh-CN' && density === 'compact' && width === 1366) await shot('grid-library-' + theme + '-1366');
    }
  }
  for (const zoom of [1.25, 1.5, 2]) {
    await open('library', 'en', 'dark', 1600, 1000, zoom);
    const result = await geometry();
    check(Math.abs(result.viewport * zoom - 1600) <= 2 && result.sidebar === 0, 'zoom-' + zoom + ': use the effective width');
    check(result.page > 0 && result.page <= 821 && result.overflow <= 1, 'zoom-' + zoom + ': reading remains visible without horizontal overflow');
    aligned(result.starts, 'zoom-' + zoom); samples.push({ label: 'zoom-' + zoom, ...result });
  }
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const density of ['compact', 'comfortable']) {
    await open('history', locale, 'light', 1280, 800, 1, '', density);
    const result = await geometry(); aligned(result.starts, 'history-' + locale + '-' + density);
    check(result.page >= 819 && result.overflow <= 1, 'history: retain the shared reading width');
    samples.push({ label: 'history-' + locale + '-' + density, ...result });
    if (locale === 'zh-CN' && density === 'compact') await shot('grid-history-alignment');
  }
  // 宽窗口内缩窄库容器，防止响应式规则错误地继续依赖整个窗口。
  await open('library', 'zh-CN', 'light', 1600, 800);
  await run('document.querySelector(".library").style.inlineSize="1280px"'); await paint();
  check((await geometry()).sidebar === 0, 'embedded width: folders follow the library container');
  await run('document.querySelector(".library").style.inlineSize="800px"'); await paint();
  const single = await geometry();
  check(single.list === 0 && single.detail > 0, 'embedded width: narrow reading keeps only the selected pane');
  if (single.list === 0) {
    await click('.folder-back-list');
    check(await run('document.querySelector(".folder-content-list").getBoundingClientRect().width > 0 && document.querySelector(".folder-detail").getBoundingClientRect().width === 0'), 'embedded width: back reveals the real list');
    await click('.library-content-row > button'); await wait('document.querySelector(".library").dataset.pane === "detail"');
    check((await geometry()).detail > 0, 'embedded width: selecting a record restores the reader');
  }
  await open('library', 'zh-CN', 'light', 1280, 800);
  await click('.folder-back-navigation');
  win.setContentSize(1366, 800); await paint();
  const wide = await geometry();
  check(wide.sidebar > 0 && wide.list > 0 && wide.detail > 0, 'resize: folder navigation expands to three usable panes');
  win.setContentSize(1280, 800); await paint();
  check(await run('document.querySelector(".folder-sidebar").getBoundingClientRect().width > 0'), 'resize: folder navigation remains reachable when returning below the breakpoint');
  await click('.library-content-row > button'); await wait('document.querySelector(".library").dataset.pane === "detail"');
  await run('window.gridReader=document.querySelector(".archive-detail-pane"); window.gridReader.scrollTop=420; document.querySelector(".folder-filters input").focus()');
  win.setContentSize(1366, 800); await paint();
  check(await run('document.querySelector(".archive-detail-pane") === window.gridReader && Math.abs(window.gridReader.scrollTop-420)<=2 && document.activeElement === document.querySelector(".folder-filters input")'), 'resize: retain reader, scroll and search focus');
  await click('.library-multi-toggle');
  check(await run('document.querySelector(".library-row-check").getBoundingClientRect().width >= 24 && document.querySelector(".library-item-title").getBoundingClientRect().width > 120'), 'selection: leave room for both checkbox and title');
  await click('.library-multi-toggle');
  flows.push({ grid: samples });
  console.log('Grid review completed: ' + samples.length + ' layout cases plus container, resize and selection flows.');
};
