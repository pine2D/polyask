const { app, BrowserWindow, nativeTheme, session } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const output = process.argv[2], cases = [], flows = [], failures = [], errors = [];
let network = 0, win;
app.setPath('userData', join(output, 'profile'));
const boundary = require('./native-process-boundary.cjs').processBoundary(app, output);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, done) => { network++; done({ cancel: true }); });
  win = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = source => win.webContents.executeJavaScript(source);
  const wait = async source => { const end = Date.now() + 6000; while (Date.now() < end) { if (await run(source)) return; await pause(40); } throw Error('wait:' + source); };
  const paint = () => run('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  const shot = async name => { await paint(); writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause(60);
  };
  const click = async selector => {
    const point = await run(`(() => {const e=document.querySelector(${JSON.stringify(selector)}),b=e.getBoundingClientRect();
      if (!e.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2))) e.scrollIntoView({block:'center',inline:'nearest'});
      const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    const factor = win.webContents.getZoomFactor(), p = { x: Math.round(point.x * factor), y: Math.round(point.y * factor), button: 'left', clickCount: 1 };
    win.webContents.sendInputEvent({ type: 'mouseDown', ...p }); win.webContents.sendInputEvent({ type: 'mouseUp', ...p }); await pause(70);
  };
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const open = async (surface, locale, theme, width, height, zoom = 1, state = '') => {
    nativeTheme.themeSource = theme; win.webContents.setZoomFactor(1); win.setContentSize(width, height);
    await win.loadFile(join(output, 'index.html'), { query: { surface, locale, state } }); win.webContents.setZoomFactor(zoom);
    await wait(surface === 'library' ? '!!document.querySelector(".folder-workspace")' : '!!document.querySelector(".question-history")');
    if (state === 'empty') {
      await wait(surface === 'history' ? 'document.querySelector(".question-empty")?.textContent === window.review.copy.questionEmpty'
        : '!document.querySelector(".archive-detail") && !!document.querySelector(".library-empty")');
      await paint(); return;
    }
    await wait(surface === 'library' ? '!!document.querySelector(".archive-detail h1")' : '!!document.querySelector(".question-main")');
    if (surface === 'history') await click('.question-main');
    if (state !== 'failure') await wait('!!document.querySelector(".markdown-preview .markdown-code")');
    await pause(100); boundary();
  };
  try {
    await require('./reading-workspace-check.cjs').checkReadingWorkspace({open,run,click,wait,shot,check,flows});
    if (!process.argv.includes('--workspace-only')) {
    if (!process.argv.includes('--flows-only')) for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const surface of ['library', 'history']) for (const theme of ['light', 'dark']) {
      for (const [size, width, height, zoom] of [['wide',1600,1000,1],['normal',1280,800,1],['narrow',960,720,1],['zoom150',1280,800,1.5]]) {
        const name = `${surface}-${locale}-${theme}-${size}`;
        await open(surface, locale, theme, width, height, zoom);
        const layout = await run(`(() => {
          const p=document.querySelector('.markdown-preview > p'), buttons=[...document.querySelectorAll('.markdown-code-actions button,.markdown-math-actions button')];
          const page=document.querySelector('.reading-page'), scroller=page.closest('.question-reader,.archive-detail-pane');
          return { height:innerHeight, paragraphBottom:p.getBoundingClientRect().bottom, bodyTop:document.querySelector('.markdown-preview').getBoundingClientRect().top,
            columnWidth:page.clientWidth, overflow:scroller.scrollWidth-scroller.clientWidth,
            paragraphWidth:p.getBoundingClientRect().width, tableWidth:document.querySelector('.markdown-table').getBoundingClientRect().width,
            codeWidth:document.querySelector('.markdown-code').getBoundingClientRect().width,
            segmentHeight:document.querySelector('.library-segments')?.getBoundingClientRect().height || 0,
            controls:buttons.slice(0,3).map(b=>{const s=getComputedStyle(b);return {border:s.borderTopStyle,radius:parseFloat(s.borderRadius),font:s.fontSize};}) };
        })()`);
        check(layout.paragraphBottom <= layout.height - 20, `${name}: first answer paragraph is pushed out of the first viewport`);
        check(layout.controls.every(b => b.border === 'solid' && b.radius >= 4 && b.font === '12px'), `${name}: reading controls fall back to browser styling`);
        check(layout.overflow <= 1, `${name}: reading page overflows horizontally`);
        check(Math.abs(layout.paragraphWidth-layout.tableWidth)<=1 && Math.abs(layout.paragraphWidth-layout.codeWidth)<=1, `${name}: content column widths diverge`);
        check(layout.segmentHeight <= 32, `${name}: kind tabs grow beyond compact height`);
        await shot(name + '-top');
        await run('document.querySelector(".markdown-code").scrollIntoView({block:"center"})'); await pause(60);
        const navigation = await run(`(() => {const r=document.querySelector('.reading-navigation').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};})()`);
        check(navigation.top >= 0 && navigation.bottom <= navigation.height, `${name}: source switching is lost while reading`);
        if (size === 'normal') await shot(name + '-code');
        cases.push({ name, ...layout, navigation });
      }
      console.log('Verified layouts: ' + locale + ' ' + surface + ' ' + theme);
    }
    for (const surface of ['library', 'history']) {
      await open(surface, 'zh-CN', 'light', 1280, 800);
      const codeHeight = await run('document.querySelector(".markdown-code").getBoundingClientRect().height');
      await click('.markdown-code-actions button');
      check(await run('window.review.clipboard.at(-1)?.startsWith("const records")'), surface + ': code copy preserves source');
      await run('window.review.failCopy=true'); await click('.markdown-code-actions button');
      check(await run('document.querySelector(".markdown-code [role=status]").textContent === window.review.copy.readingCopyFailed'), surface + ': failed copy remains retryable');
      await run('window.review.failCopy=false'); await click('.markdown-code-actions button');
      check(await run('window.review.clipboard.length === 2'), surface + ': copy retry succeeds');
      check(Math.abs(await run('document.querySelector(".markdown-code").getBoundingClientRect().height')-codeHeight)<=1, surface + ': copy feedback does not shift the reading content');
      check(await run('!!document.querySelector(".markdown-code .code-keyword")'), surface + ': code is highlighted without a separate action');
      await click('.markdown-math-actions button'); await wait('!!document.querySelector(".markdown-math math")');
      await shot(surface + '-reading-interactions');
      if (surface === 'history') {
        const position = await run('document.querySelector(".question-reader").scrollTop');
        await click('.question-site-tabs button:nth-child(2)'); await wait('document.querySelector(".question-site-tabs button:nth-child(2)").ariaPressed === "true" && !!document.querySelector(".markdown-preview")');
        check(await run('document.querySelector(".question-reader").scrollTop < 2'), 'history: unseen source starts at the beginning');
        await click('.question-site-tabs button:first-child'); await wait('document.querySelector(".question-site-tabs button:first-child").ariaPressed === "true" && !!document.querySelector(".markdown-preview")');
        const restored = await run('document.querySelector(".question-reader").scrollTop');
        check(Math.abs(restored-position) <= 2, 'history: source return restores its independent reading position');
        await run('document.querySelector(".markdown-code-actions button").focus()'); await key('Tab');
        check(await run('(() => {const a=document.activeElement.getBoundingClientRect(),n=document.querySelector(".reading-navigation").getBoundingClientRect();return a.top >= n.bottom-1 && a.bottom <= innerHeight;})()'), 'history: keyboard target stays below sticky navigation');
        flows.push({surface, position, restored});
      } else {
        await run('document.querySelector(".archive-answer-nav a:last-child").focus()'); await key('Return');
        await wait('location.hash === "#archive-answer-8" && document.querySelector(".archive-answer-nav a:last-child").ariaCurrent === "location"');
        check(await run('(() => {const a=document.querySelector(".archive-answer-nav a:last-child").getBoundingClientRect(),n=document.querySelector(".archive-answer-nav").getBoundingClientRect();return a.left>=n.left-1 && a.right<=n.right+1;})()'), 'library: current source is visible in the horizontal navigation');
        const readingBefore = await run('({scroll:document.querySelector(".archive-detail-pane").scrollTop,current:document.querySelector(".archive-answer-nav [aria-current]")?.getAttribute("href"),targetTop:document.querySelector("#archive-answer-8").getBoundingClientRect().top,navBottom:document.querySelector(".reading-navigation").getBoundingClientRect().bottom})');
        await click('.library-view-switch button:nth-child(2)'); await wait('!!document.querySelector(".archive-compare-column")');
        check(await run('document.activeElement === document.querySelector(".library-view-switch button:nth-child(2)")'), 'library: entering comparison retains keyboard focus on the mode control');
        const widths = await run('[...document.querySelectorAll(".archive-compare-column")].map(e=>e.getBoundingClientRect().width)');
        check(widths.every(width=>width>=480), 'library: comparison gives both answers a readable column');
        await shot('library-comparison-focused');
        await click('.library-view-switch button:first-child'); await wait('!!document.querySelector(".archive-answer")');
        await paint();
        check(await run('document.querySelector(".archive-answer-nav a:last-child").ariaCurrent === "location"'), 'library: returning from comparison restores the source');
        check(await run('document.activeElement === document.querySelector(".library-view-switch button:first-child")'), 'library: returning to reading retains mode-control focus');
        const readingAfter = await run('({scroll:document.querySelector(".archive-detail-pane").scrollTop,current:document.querySelector(".archive-answer-nav [aria-current]")?.getAttribute("href"),targetTop:document.querySelector("#archive-answer-8").getBoundingClientRect().top,navBottom:document.querySelector(".reading-navigation").getBoundingClientRect().bottom})');
        check(Math.abs((readingAfter.targetTop-readingAfter.navBottom)-(readingBefore.targetTop-readingBefore.navBottom))<=3, 'library: returning restores the source position after transient content reflows');
        await shot('library-return-from-comparison'); flows.push({surface, widths, readingBefore, readingAfter});
      }
    }
    await open('library','en','light',1280,800,1.5);
    await click('.library-view-switch button:nth-child(2)'); await wait('document.querySelector(".library").dataset.focused === "true"');
    await click('.folder-back-list');
    check(await run('document.querySelector(".library").dataset.focused === "false" && document.querySelector(".folder-content-list").getBoundingClientRect().width > 0'), 'library: narrow comparison returns to a visible list');
    await shot('library-zoom150-return-to-list');
    for (const surface of ['library','history']) for (const theme of ['light','dark']) {
      await open(surface, 'zh-CN', theme, 960, 720, 1, 'empty');
      check(await run('!document.querySelector(".markdown-preview") && !document.querySelector(".question-main")'), surface + ': empty state has no stale answer');
      await shot(`${surface}-${theme}-empty`);
      await open(surface, 'zh-CN', theme, 960, 720, 1, 'long');
      const selector = surface === 'library' ? '.archive-question-prompt button' : '.question-prompt button';
      check(await run(`document.querySelector(${JSON.stringify(selector)})?.ariaExpanded === 'false'`), surface + ': long question starts collapsed');
      await click(selector); check(await run(`document.querySelector(${JSON.stringify(selector)}).ariaExpanded === 'true'`), surface + ': exact long question expands');
      await click(selector); await shot(`${surface}-${theme}-long-question`);
    }
    await open('history','zh-CN','light',960,720,1,'failure');
    await wait('!!document.querySelector(".question-detail-state button")'); await shot('history-load-failure');
    await run('window.review.failRead=false'); await click('.question-detail-state button'); await wait('!!document.querySelector(".markdown-preview")');
    check(await run('!!document.querySelector(".reading-navigation")'), 'history: failed read can recover into the complete reading page');
    }
    console.log(JSON.stringify({cases:cases.length, flows, failures, errors, network})); boundary();
  } catch (error) { failures.push(error.stack); console.error(error.stack); }
  writeFileSync(join(output, 'report.json'), JSON.stringify({cases, flows, failures, errors, network}, null, 2));
  win.destroy(); app.exit(failures.length || errors.length || network ? 1 : 0);
}).catch(error => { console.error(error.stack); app.exit(1); });
