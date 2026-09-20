const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1600, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (await run(source)) return; await pause(30); }
    throw new Error(`UI wait timed out: ${source}`);
  };
  const click = async selector => {
    const box = await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center',inline:'nearest'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...box, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...box, button: 'left', clickCount: 1 });
    await pause(60);
  };
  const key = async keyCode => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(60); };
  const fill = async (selector, value) => {
    await run(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); e.focus(); Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause(60);
  };
  const shot = async name => writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const geometry = async () => run(`(() => {
    const selectors=['.folder-toolbar','.folder-content-list','.folder-detail','.archive-detail','.decision-editor'];
    return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length).map(e=>({selector,width:e.clientWidth,scroll:e.scrollWidth,right:e.getBoundingClientRect().right,viewport:innerWidth})));
  })()`);
  const reports = [];
  for (const locale of (process.env.POLYASK_UI_QUICK ? [] : ['zh-CN', 'zh-TW', 'en'])) {
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme;
      for (const width of [960, 1280, 1600]) {
        win.setContentSize(width, 900);
        await win.loadFile(join(output, 'index.html'), { query: { locale } });
        await wait('!!document.querySelector(".archive-detail h1")');
        await pause(100);
        const boxes = await geometry();
        for (const box of boxes) {
          assert.ok(box.scroll <= box.width + 2, `${locale}/${theme}/${width} overflow ${JSON.stringify(box)}`);
          assert.ok(box.right <= box.viewport + 2, `${locale}/${theme}/${width} offscreen ${JSON.stringify(box)}`);
        }
        reports.push({ locale, theme, width, boxes });
        if (locale === 'zh-CN' && (width === 960 || width === 1600)) await shot(`reading-${theme}-${width}`);
      }
    }
  }
  nativeTheme.themeSource = 'light';
  win.setContentSize(1600, 1000);
  await win.loadFile(join(output, 'index.html'));
  await wait('!!document.querySelector(".archive-detail h1")');
  // Open a searchable select, keyboard navigation, Escape and focus restoration.
  await click('.library-select');
  await wait('!!document.querySelector(".library-popover input")');
  await fill('.library-popover input', '长');
  await key('Up');
  assert.equal(await run('document.querySelectorAll("[role=option][data-active=true]").length'), 1);
  await shot('tag-menu');
  await key('Escape');
  assert.equal(await run('!!document.querySelector(".library-popover")'), false);
  assert.equal(await run('document.activeElement.classList.contains("library-select")'), true);
  assert.equal(await run('document.body.dataset.closed'), undefined);
  await click('.library-select'); await key('Tab');
  assert.equal(await run('!!document.querySelector(".library-popover")'), false);
  assert.equal(await run('document.activeElement.tagName === "BODY"'), false);
  // Actions stay in an accessible menu; deletion requires an explicit confirmation.
  await click('.archive-actions .library-menu-trigger');
  await key('End');
  await key('Return');
  await wait('!!document.querySelector("[role=dialog]")');
  assert.equal(await run('document.activeElement.textContent'), '取消');
  await key('Escape');
  assert.equal(await run('!!document.querySelector("[role=dialog]")'), false);
  // Metadata navigation guard and failure preserve unsaved input.
  await click('.archive-metadata summary');
  await fill('[name=archive-note]', '未保存的备注');
  await click('.library-close');
  await wait('!!document.querySelector("[role=dialog]")');
  await key('Escape');
  assert.equal(await run('document.querySelector("[name=archive-note]").value'), '未保存的备注');
  await run('window.libraryTest.failSave=true');
  await click('.library-metadata-actions button[type=submit]');
  await wait('document.querySelector(".archive-status").textContent.length > 0');
  assert.equal(await run('document.querySelector("[name=archive-note]").value'), '未保存的备注');
  await run('window.libraryTest.failSave=false');
  await click('.library-metadata-actions button[type=submit]');
  await wait('window.libraryTest.writes === 1');
  await click('.archive-metadata summary');
  // Link opens through the shell facade; shell location stays on the fixture.
  await click('.archive-answers .markdown-preview a');
  assert.equal(await run('window.libraryTest.links.length'), 1);
  assert.ok(await run('location.protocol === "file:"'));
  // Comparison uses two columns only when its own container has room.
  await click('.library-view-switch button:nth-child(2)');
  await wait('!!document.querySelector(".archive-compare-grid")');
  await shot('comparison-wide');
  win.setContentSize(960, 900); await pause(100);
  assert.equal(await run('getComputedStyle(document.querySelector(".archive-compare-grid")).gridTemplateColumns.split(" ").length'), 1);
  await shot('comparison-narrow');
  await click('.library-focus'); await pause(100);
  assert.equal(await run('getComputedStyle(document.querySelector(".archive-compare-grid")).gridTemplateColumns.split(" ").length'), 2);
  await click('.library-focus');
  // Decision editing shares the selector and protects the draft on navigation.
  await click('.library-segments button:nth-child(3)');
  await wait('document.querySelectorAll(".archive-list > button").length === 1');
  await click('.archive-list > button');
  await wait('!!document.querySelector(".decision-editor")');
  await shot('decision-reading');
  await click('.library-decision-actions > button:nth-child(2)');
  await wait('!!document.querySelector("[name=decision-title]")');
  await fill('[name=decision-conclusion]', '保留草稿，明确保存。');
  await click('.decision-meta .library-select'); await key('Down'); await key('Return');
  await shot('decision-editing');
  await click('.library-close');
  await wait('!!document.querySelector("[role=dialog]")');
  await key('Escape');
  assert.equal(await run('document.querySelector("[name=decision-conclusion]").value'), '保留草稿，明确保存。');
  await click('.library-decision-actions .library-primary');
  await wait('!document.querySelector("[name=decision-title]")');
  // Folder dialog keeps the selection when its search hides checked rows.
  await click('.library-decision-actions > button:first-child');
  await wait('!!document.querySelector(".folder-checkboxes input")');
  await click('.folder-checkboxes input');
  await fill('[name=folder-membership-search]', 'no-match');
  assert.ok((await run('document.querySelector(".library-selection-count").textContent')).includes('1'));
  await key('Escape');
  // OS zoom: toolbar and panes remain contained with a 1.5 scale factor.
  win.webContents.setZoomFactor(1.5); await pause(100);
  for (const box of await geometry()) assert.ok(box.scroll <= box.width + 2, `zoom overflow ${JSON.stringify(box)}`);
  assert.ok(await run('document.querySelector(".archive-detail-pane").getBoundingClientRect().width >= document.querySelector(".folder-detail").getBoundingClientRect().width - 2'), 'embedded decision must use the entire detail width at zoom');
  await shot('zoom-150');
  win.webContents.setZoomFactor(1);
  // Empty and failed searches retain a usable search field and recover on retry.
  await click('.library-segments button:first-child');
  await fill('[name=library-search]', 'no-matching-record');
  await wait('document.querySelectorAll(".archive-list > button").length === 0 && !document.querySelector(".archive-list[aria-busy=true]")');
  assert.equal(await run('document.activeElement.name'), 'library-search');
  await run('window.libraryTest.failLoad=true');
  await fill('[name=library-search]', 'failure');
  await wait('!!document.querySelector(".library-empty button")');
  await run('window.libraryTest.failLoad=false');
  await fill('[name=library-search]', '');
  await wait('document.querySelectorAll(".archive-list > button").length === 9');
  await click('.archive-list > button');
  await wait('!!document.querySelector(".archive-detail")');
  // Removing the active result while focused restores browsing, instead of trapping an empty pane.
  await click('.library-focus');
  await click('.archive-actions .library-menu-trigger');
  await click('[role=menuitem]:last-child');
  await wait('!!document.querySelector("[role=dialog]")');
  await click('.confirm-actions .primary');
  await wait('document.querySelectorAll(".archive-list > button").length === 8');
  assert.equal(await run('document.querySelector(".library").dataset.focused'), 'false');
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ matrix: reports, interactions: 'passed', consoleErrors: errors }, null, 2));
  console.log(`Library UI passed: ${reports.length} layout variants and keyboard/editing flows.`);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
