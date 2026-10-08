const { app, BrowserWindow, session, nativeTheme, clipboard } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
let captureFailure = null;
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1100, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  let scenario = 'startup', lastStep = 'matrix', lastInput = null;
  captureFailure = async error => {
    writeFileSync(join(output, 'failure.json'), JSON.stringify({ scenario, lastStep, lastInput,
      message: String(error.message).replace(/\s+/g, ' ').slice(0, 180) }, null, 2));
    if (!win.isDestroyed()) writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  };
  const js = async source => {
    let result;
    try {
      result = await win.webContents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (0,eval)(${JSON.stringify(source)})};}
        catch(error){return {ok:false,name:String(error?.name||'Error').slice(0,32),
          message:String(error?.message||'renderer_error').replace(/\\s+/g,' ').slice(0,160)};}})()`);
    } catch (error) { result = { ok: false, name: 'ExecuteError', message: String(error.message).slice(0, 160) }; }
    if (!result.ok) {
      const sourcePrefix = source.replace(/\s+/g, ' ').slice(0, 90);
      writeFileSync(join(output, 'renderer-error.json'), JSON.stringify({ scenario, lastStep, sourcePrefix,
        name: result.name, message: result.message, lastInput }, null, 2));
      throw new Error(`${scenario}/${lastStep}: ${result.name}: ${result.message} (see renderer-error.json and failure.png)`);
    }
    return result.value;
  };
  const pause = () => js('new Promise(resolve => setTimeout(resolve, 30))');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const until = async (source, label) => {
    for (let i = 0; i < 180; i++) { if (await js(source)) return; await pause(); }
    const surface = await js(`({viewport:innerWidth,reader:!!document.querySelector('.question-reader'),
      list:!!document.querySelector('.question-main'),picker:!!document.querySelector('.question-archive-picker'),
      body:!!document.querySelector('.markdown-preview'),state:document.querySelector('[data-state]')?.getAttribute('data-state')||'none'})`);
    writeFileSync(join(output, 'timeout.json'), JSON.stringify({ scenario, lastStep, label, zoom: win.webContents.getZoomFactor(), lastInput, ...surface }, null, 2));
    writeFileSync(join(output, 'timeout.png'), (await win.webContents.capturePage()).toPNG());
    throw new Error(`${scenario}: Timed out: ${label} (see timeout.json/png)`);
  };
  const key = async (keyCode, modifiers = []) => {
    win.focus(); await until('document.hasFocus()', 'native window focus');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await pause();
  };
  const click = async selector => {
    win.focus(); await until('document.hasFocus()', 'native window focus');
    const point = await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
      const point=()=>{const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}};
      const hit=p=>{const target=document.elementFromPoint(p.x,p.y);return target===node||node.contains(target)};
      let p=point();if(!hit(p)){node.scrollIntoView({block:'nearest'});p=point();}return hit(p)?p:null;})()`);
    check(!!point, `Missing control: ${selector}`);
    await js(`(()=>{if(window.historyNativeClickHandler)document.removeEventListener('click',window.historyNativeClickHandler,true);
      const node=document.querySelector(${JSON.stringify(selector)});window.historyNativeClickProbe=null;
      window.historyNativeClickHandler=event=>{window.historyNativeClickProbe={trusted:event.isTrusted,hit:node===event.target||node.contains(event.target),
        x:event.clientX,y:event.clientY,kind:['BUTTON','INPUT','SELECT','A'].includes(event.target.tagName)?event.target.tagName:'other'};};
      document.addEventListener('click',window.historyNativeClickHandler,{once:true,capture:true});})()`);
    // DOM 几何是 CSS 坐标，sendInputEvent 接收缩放前的窗口坐标。
    const zoom = win.webContents.getZoomFactor(), sent = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...sent });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...sent }); await pause();
    lastInput = { selector, zoom, expected: point, sent, actual: await js('window.historyNativeClickProbe') };
    const kind = await js(`document.querySelector(${JSON.stringify(selector)})?.tagName||'departed'`);
    if (kind !== 'SELECT' && (!lastInput.actual?.trusted || !lastInput.actual?.hit)) {
      writeFileSync(join(output, 'input-miss.json'), JSON.stringify({ scenario, ...lastInput }, null, 2));
      writeFileSync(join(output, 'input-miss.png'), (await win.webContents.capturePage()).toPNG());
      throw new Error(`${scenario}: native input missed ${selector} (see input-miss.json/png)`);
    }
  };
  const select = async (selector, offset) => {
    await click(selector); await key('Home');
    for (let i = 0; i < offset; i++) await key('Down');
    await key('Return');
  };
  const open = async (locale = 'en', theme = 'light', width = 1100, zoom = 1) => {
    scenario = `${locale}-${theme}-${width}-${Math.round(zoom * 100)}`;
    win.webContents.setZoomFactor(1);
    nativeTheme.themeSource = theme; win.setContentSize(width, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    win.webContents.setZoomFactor(zoom);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await until(`Math.abs(innerWidth-${width / zoom})<=1`, 'settled zoom viewport');
    await until('!!document.querySelector(".question-main")', 'history list');
    await click('.question-main');
    await until('!!document.querySelector(".markdown-preview")', 'saved answer');
  };
  const clipboardEvidence = [];
  const copyPrompt = async () => {
    const expected = await js('window.historyFixture.prompt');
    await clipboard.writeText('PolyAsk native fixture: pending original copy');
    await click('[data-action=copy-question]');
    let actual = await clipboard.readText();
    const initialLength = actual.length;
    let rounds = 0;
    while (actual !== expected && rounds < 60) { rounds++; await pause(); actual = await clipboard.readText(); }
    const detail = await js(`({secure:isSecureContext,focused:document.hasFocus(),clipboardApi:typeof navigator.clipboard?.writeText==='function',
      copied:document.querySelector('.feedback-notice')?.textContent===window.historyFixture.labels.copied,
      failed:document.querySelector('.feedback-notice')?.textContent===window.historyFixture.labels.copyFailed})`);
    const exact = actual === expected;
    clipboardEvidence.push({ expectedLength: expected.length, initialLength, rounds, exact, systemReadType: typeof actual,
      selection: 'system', ...detail, windowFocused: win.isFocused() });
    writeFileSync(join(output, 'clipboard.json'), JSON.stringify(clipboardEvidence, null, 2));
    if (!exact) writeFileSync(join(output, 'clipboard-failure.png'), (await win.webContents.capturePage()).toPNG());
    check(exact, 'native clipboard must contain the complete original prompt (see clipboard.json and clipboard-failure.png)');
  };
  const organize = async () => {
    await click('[data-action=organize-saved-answer]');
    await until('!!document.querySelector(".question-archive-picker [role=dialog]")', 'copy picker');
  };
  const state = () => js('window.historyFixture.state()');
  const geometry = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    for (const [width, zoom] of [[1100, 1], [640, 1], [420, 1], [640, 1.5]]) {
      await open(locale, theme, width, zoom);
      const name = `${locale}-${theme}-${width}-${Math.round(zoom * 100)}`;
      const measure = await js(`(()=>{const r=document.querySelector('.question-reader'),h=document.querySelector('.question-prompt h2');
        return {viewport:innerWidth,reader:r.clientWidth,overflow:r.scrollWidth-r.clientWidth,summary:h.classList.contains('is-summary'),
          height:h.getBoundingClientRect().height,line:parseFloat(getComputedStyle(h).lineHeight),dark:matchMedia('(prefers-color-scheme: dark)').matches};})()`);
      const icons = await js(`Array.from(document.querySelectorAll('.question-reader-actions .library-menu-trigger')).map(n=>{
        const b=n.getBoundingClientRect(),s=n.querySelector('svg').getBoundingClientRect();
        return {dx:s.x+s.width/2-b.x-b.width/2,dy:s.y+s.height/2-b.y-b.height/2};})`);
      check(icons.length === 2 && icons.every(p=>Math.abs(p.dx)<.5&&Math.abs(p.dy)<.5), `${name}: menu icons are centered`);
      await click('.question-prompt-actions .library-menu-trigger');
      const danger = await js(`(()=>{const s=getComputedStyle(document.querySelector('.library-action-menu button.danger'));return {border:s.borderTopWidth,margin:s.marginTop};})()`);
      check(danger.border === '0px' && danger.margin === '0px', `${name}: single deletion has no separator`);
      await key('Escape');
      const evidence = { name, ...measure, icons, danger }; geometry.push(evidence);
      writeFileSync(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
      check(measure.summary && measure.height <= measure.line * 3 + 1, `${name}: prompt summary must stay within three lines`);
      check(measure.overflow <= 1, `${name}: saved reading must have no horizontal overflow (${measure.overflow}px)`);
      check(measure.dark === (theme === 'dark'), `${name}: native theme must match`);
      await click('.question-prompt > button');
      check(await js('document.querySelector(".question-prompt h2").textContent === window.historyFixture.prompt'), `${name}: expand must retain all original text`);
      await copyPrompt();
      await click('.question-prompt > button');
      await organize();
      const picker = await js(`(()=>{const d=document.querySelector('.question-archive-picker [role=dialog]'),r=d.getBoundingClientRect();
        return {left:r.left,right:r.right,viewport:innerWidth,overflow:d.scrollWidth-d.clientWidth};})()`);
      check(picker.left >= -1 && picker.right <= picker.viewport + 1 && picker.overflow <= 1, `${name}: picker must fit the viewport`);
      await key('Escape');
      check(await js('document.activeElement === document.querySelector("[data-action=organize-saved-answer]")'), `${name}: picker Escape returns focus`);
      evidence.picker = picker;
      writeFileSync(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
      if (width === 420 || zoom > 1) {
        await pause(); const screenshot = await win.webContents.capturePage();
        writeFileSync(join(output, `${name}.png`), screenshot.toPNG());
      }
    }
  }
  writeFileSync(join(output, 'geometry.json'), JSON.stringify(geometry, null, 2));
  console.log(JSON.stringify({ scenario: 'three-locales-two-themes-widths-and-zoom', cases: geometry.length, ok: true }));

  await open();
  scenario = 'saved-reader-and-results-flow';
  lastStep = 'reader-scroll';
  await select('.question-answer-meta select', 0);
  await until('document.querySelector(".question-answer-meta select").value === "a1" && !!document.querySelector(".markdown-preview")', 'older attempt');
  await js('document.querySelector(".question-reader").scrollTop=650'); await pause();
  const oldScroll = await js('document.querySelector(".question-reader").scrollTop');
  const tabsVisible = await js(`(()=>{const r=document.querySelector('.question-site-tabs').getBoundingClientRect(),
    clip=document.querySelector('.question-reader').getBoundingClientRect();return r.top>=clip.top&&r.bottom<=clip.bottom;})()`);
  // 页内滚动本身会更新阅读位置；此段只隔离切站恢复，物理 select/Tab/鼠标另行覆盖。
  await js('document.querySelector(".question-site-tabs button:last-child").click()'); await pause();
  await js('document.querySelector(".question-site-tabs button:first-child").click()'); await pause();
  check(await js('document.querySelector(".question-answer-meta select").value === "a1"'), 'returning to a site keeps its older attempt');
  check(Math.abs(await js('document.querySelector(".question-reader").scrollTop') - oldScroll) < 2, 'returning to a site restores answer scroll');
  await click('.question-header button:not(.panel-close)'); await click('.question-main');
  await until('!!document.querySelector(".markdown-preview")', 'reopened answer');
  check(await js('document.querySelector(".question-answer-meta select").value === "a1"'), 'back and reopen preserves the selected attempt');
  check(Math.abs(await js('document.querySelector(".question-reader").scrollTop') - oldScroll) < 2, 'back and reopen restores answer scroll');
  console.log(JSON.stringify({ scenario: 'reader-scroll-evidence', tabsVisibleAtSavedPosition: tabsVisible,
    siteSwitching: 'programmatic-state-only', leavingAndReopening: 'native-mouse', scroll: oldScroll, ok: true }));
  lastStep = 'reader-mermaid-and-links';
  await until('!!document.querySelector(".mermaid-canvas img")', 'saved Mermaid preview');
  await js('document.querySelector(".question-prompt-actions button[aria-haspopup=menu]").focus()');
  for (const selector of ['.markdown-preview a[href="https://example.com/first"]',
    '.markdown-preview a[href="https://example.com/second"]', '.mermaid-tabs button:first-child']) {
    await key('Tab');
    check(await js(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`), 'native Tab reaches source links and Mermaid controls');
  }
  await click('.mermaid-tabs button:last-child');
  check(await js('!document.querySelector(".mermaid-preview pre").hidden && document.querySelector(".mermaid-preview code").textContent.includes("flowchart LR")'), 'saved Mermaid source remains reachable');

  lastStep = 'deferred-body-switch';
  await js('window.historyFixture.readDelay(true)');
  await click('.question-site-tabs button:last-child');
  check(await js('document.querySelector(".question-empty[data-state=loading]")?.textContent.includes(window.historyFixture.labels.loading) && !document.querySelector(".markdown-preview")'), 'slow site switches show loading without old body');
  check(await js('[...document.querySelectorAll("button[aria-label]")].find(button=>button.getAttribute("aria-label")===window.historyFixture.labels.answerCopy)?.disabled===true'), 'loading copy action is disabled');
  await click('.question-site-tabs button:first-child');
  await select('.question-answer-meta select', 1);
  await js('window.historyFixture.resolveRead("a2")'); await pause();
  await js('window.historyFixture.resolveRead("b1");window.historyFixture.resolveRead("a1")'); await pause();
  check(await js('document.querySelector(".question-answer-meta select").value === "a2" && document.querySelector(".markdown-preview").textContent.includes("a2 paragraph")'), 'out-of-order responses retain the latest selected body');
  lastStep = 'deferred-body-retry';
  await click('.question-site-tabs button:last-child');
  await js('window.historyFixture.rejectRead("b1")'); await pause();
  check(await js('document.querySelector(".question-empty[role=alert]")?.textContent.includes(window.historyFixture.labels.failed)'), 'body failure is distinct from missing copy');
  await click('.question-empty button');
  await js('window.historyFixture.resolveRead("b1");window.historyFixture.readDelay(false)'); await pause();
  check(await js('document.querySelector(".markdown-preview").textContent.includes("b1 paragraph")'), 'retry reads the failed selected answer');
  await click('.question-site-tabs button:first-child'); await select('.question-answer-meta select', 0);

  lastStep = 'picker-cancel';
  await js('document.querySelector(".question-reader").scrollTop=0'); await pause();
  await organize();
  await key('Tab');
  check(await js('document.querySelector(".question-archive-picker [role=dialog]").contains(document.activeElement)'), 'native Tab stays in the local picker');
  await key('Escape');
  check((await state()).requests === 0 && !(await state()).blocking, 'cancel has no write and releases blocking');
  lastStep = 'picker-create-refresh';
  await organize(); await js('window.historyFixture.createFail()'); await click('[data-question-archive=read]');
  check(await js('!!document.querySelector(".question-archive-picker [role=alert]") && document.querySelector("[data-archive-site=claude] select").value === "a1"'), 'creation failure preserves selected older attempt');
  await click('[data-question-archive=refresh]');
  check(await js('document.querySelector("[data-archive-site=claude] select").value === "" && document.querySelector("[data-question-archive=read]").disabled'), 'refresh requires explicit candidate recheck');
  lastStep = 'snapshot-read';
  await select('[data-archive-site=claude] select', 1); await click('[data-question-archive=read]');
  await until('document.querySelector(".archive-detail")?.dataset.view === "read"', 'new result read mode');
  let saved = await state();
  check(saved.selectedIds === 'a1' && saved.resultCount === 1 && saved.oldIdentity && saved.oldTruncated, 'one-site snapshot keeps older attempt and truncation identity');
  check(saved.promptExact && saved.bodiesExact && saved.sourceNull && saved.captures === 0, 'result preserves saved data without current-page collection');
  lastStep = 'folder-membership';
  await click('.library-organize');
  await until('!!document.querySelector("input[data-folder-id=fixture-folder]")', 'existing folder dialog');
  await click('input[data-folder-id=fixture-folder]'); await click('[data-action=save-memberships]');
  await until('!document.querySelector("[role=dialog]")', 'folder saved');
  saved = await state();
  check(saved.folderTarget === 'archive:history-result-1' && saved.folderIds === 'fixture-folder', 'folder association uses the new snapshot ID');
  lastStep = 'snapshot-compare';
  await click('.library-close'); await until('!!document.querySelector(".question-main")', 'history reopened'); await click('.question-main');
  await until('!!document.querySelector(".markdown-preview")', 'saved answer reopened');
  await organize(); await select('[data-archive-site=kimi] select', 1); await click('[data-question-archive=compare]');
  await until('document.querySelector(".archive-detail")?.dataset.view === "compare"', 'new result compare mode');
  saved = await state();
  check(saved.selectedIds === 'a1,b1' && saved.resultCount === 2 && saved.hosts === 'claude.ai,www.kimi.com', 'comparison keeps one chosen attempt per site in source order');
  check(saved.promptExact && saved.bodiesExact && saved.sourceNull && saved.captures === 0, 'comparison uses only saved copies');
  console.log(JSON.stringify({ scenario: 'old-copy-read-compare-and-existing-folder', ok: true, ...saved }));

  lastStep = 'snapshot-busy-late';
  await click('.library-close'); await until('!!document.querySelector(".question-main")', 'history return'); await click('.question-main');
  await until('!!document.querySelector(".markdown-preview")', 'returned answer');
  await organize(); await js('window.historyFixture.createDelay(true)'); await click('[data-question-archive=read]');
  await js('window.historyFixture.busy(true)'); await pause();
  await js('window.historyFixture.resolveCreate()'); await pause();
  saved = await state();
  check(saved.archiveCount === 3 && saved.captures === 0, 'authorized snapshot stays saved after navigation becomes unavailable');
  check(await js('!!document.querySelector(".question-reader") && !document.querySelector(".archive-detail")'), 'old create reply cannot navigate a busy surface');
  lastStep = 'departed-body-read';
  await js('window.historyFixture.busy(false);window.historyFixture.readDelay(true)');
  await click('.question-site-tabs button:last-child'); await click('.question-header button:not(.panel-close)');
  await js('window.historyFixture.resolveRead("b1");window.historyFixture.readDelay(false)'); await pause();
  check(await js('!!document.querySelector(".question-main") && !document.querySelector(".question-reader")'), 'departed read reply cannot restore old detail');
  lastStep = 'prompt-copy-reask';
  await click('.question-main'); await until('!!document.querySelector(".markdown-preview")', 'detail before reask');
  await js('document.querySelector(".question-reader").scrollTop=0'); await pause();
  await copyPrompt(); await click('[data-action=reask-question]');
  check((await state()).draftExact && await js('!document.querySelector(".question-history")'), 'reask passes the complete original and closes history');
  console.log(JSON.stringify({ scenario: 'late-replies-and-full-reask', ok: true, ...await state() }));
  win.destroy(); app.exit(0);
}).catch(async error => {
  if (captureFailure) { try { await captureFailure(error); } catch {} }
  console.error(String(error.message).slice(0, 1000)); app.exit(1);
});
