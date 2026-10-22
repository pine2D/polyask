const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { nativeReadingTools } = require('./comparison-native-tools.cjs');
const { processBoundary } = require('./native-process-boundary.cjs');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
let win, tools;
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }));
  win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
  const state = { scenario: 'startup', step: 'load', lastInput: null }, report = [], geometry = [], inputs = [], failures = [];
  tools = nativeReadingTools(win, output, state, source => win.webContents.executeJavaScript(source));
  const { js, check, until, click, key, type } = tools, boundary = processBoundary(app, output);
  boundary();
  const mark = async expression => { await js(`(()=>{document.querySelectorAll('[data-recovery-target]').forEach(node=>node.removeAttribute('data-recovery-target'));const node=${expression};if(!node)throw Error('missing_recovery_target');node.setAttribute('data-recovery-target','yes');})()`); return '[data-recovery-target]'; };
  const label = (name, scope = 'document') => mark(`[...${scope}.querySelectorAll('button')].find(node=>node.textContent.trim()===window.recoveryFixture.copy.${name})`);
  const settle = () => js('new Promise(resolve=>setTimeout(resolve,150))');
  const snapshot = async name => {
    await settle(); const value = await tools.geometry(name); geometry.push(value);
    check(!value.overflow && !value.controlOverflow, `${name}: horizontal containment`);
    writeFileSync(join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const open = async (mode, sample) => {
    state.scenario = `${sample.locale}-${sample.theme}-${sample.width}-${mode}`; state.step = 'load';
    nativeTheme.themeSource = sample.theme; win.setContentSize(sample.width, 900);
    await win.loadFile(join(output, 'index.html'), { query: { locale: sample.locale, mode } });
    await until('!!window.recoveryFixture&&!!document.querySelector(".folder-workspace")', 'fixture');
    await js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    win.focus(); win.webContents.focus(); await until('document.hasFocus()', 'focused fixture');
    boundary();
  };
  const enter = async () => {
    win.focus(); win.webContents.focus();
    await js(`document.addEventListener('keydown',event=>{window.recoveryKey={trusted:event.isTrusted,tag:event.target.tagName,origin:event.target.dataset.decisionOrigin};},{once:true,capture:true})`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await js('new Promise(resolve=>setTimeout(resolve,30))');
    const actual = await js('window.recoveryKey'); check(actual?.trusted, 'trusted native keyboard activation');
    inputs.push({ scenario: state.scenario, step: state.step, ...actual }); state.lastInput = { type: 'enter', actual };
  };
  const activate = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`); await enter(); };
  const retry = async (selector, message) => {
    await until(`document.querySelector(${JSON.stringify(selector)})?.disabled===false&&document.querySelector(${JSON.stringify(message)})?.textContent.trim().length>0`, 'failed action');
    check(await js(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), 'failure restores action focus');
  };
  const finish = name => { report.push({ scenario: `${state.scenario}:${name}`, ok: true }); console.log(report.at(-1).scenario); };
  const run = async task => {
    try { await task(); } catch (error) {
      failures.push({ scenario: state.scenario, step: state.step, message: String(error.message) });
      await tools.failure(error); writeFileSync(join(output, `${state.scenario}-failed.png`), (await win.webContents.capturePage()).toPNG());
      writeFileSync(join(output, 'failures.json'), JSON.stringify(failures, null, 2));
    }
  };
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    const sample = { locale, theme, width: theme === 'light' ? 1440 : 960 };
    for (const mode of ['read', 'compare']) await run(async () => {
      await open(mode, sample);
      await until('!!document.querySelector(".archive-detail")&&document.querySelector(".folder-content-list .archive-list")?.getAttribute("aria-busy")==="false"', 'selected result');
      let answerPositions = [];
      if (mode === 'compare') {
        await js('document.querySelectorAll(".archive-compare-column").forEach((node,index)=>{node.scrollTop=200+index*100;node.dispatchEvent(new Event("scroll",{bubbles:true}));})');
        answerPositions = await js('[...document.querySelectorAll(".archive-compare-column")].map(node=>node.scrollTop)');
        await click('.comparison-manual-entry');
        await type('[name=comparison-judgment]', 'Keep the reviewed judgment.');
        await js('document.querySelector("[data-decision-origin=manual]").scrollIntoView({block:"nearest"})');
        await settle();
      }
      const origin = mode === 'read' ? '[data-decision-origin=record]' : '[data-decision-origin=manual]';
      await js(`(()=>{const pane=document.querySelector('.archive-detail-pane'),list=document.querySelector('.folder-content-list .archive-list');list.scrollTop=140;${mode === 'read' ? 'pane.scrollTop=180;' : ''}})()`);
      await js(`document.querySelector(${JSON.stringify(origin)}).focus({preventScroll:true});window.recoveryExpected={pane:document.querySelector('.archive-detail-pane').scrollTop,list:document.querySelector('.folder-content-list .archive-list').scrollTop,focused:document.querySelector('.folder-workspace').dataset.focused,manual:document.querySelector('.manual-comparison')?.scrollTop};`);
      check(await js(`document.activeElement===document.querySelector(${JSON.stringify(origin)})`), 'source action has focus before native activation');
      await enter();
      await until('!!document.querySelector("[name=decision-title]")', 'new decision');
      await click(await label('decisionCancel', "document.querySelector('.decision-detail-actions')"));
      await click('.confirm-actions .primary');
      await until('!!document.querySelector(".archive-detail")&&!document.querySelector(".decision-workspace")', 'return to source');
      await settle();
      const restored = await js(`(()=>{const expected=window.recoveryExpected,pane=document.querySelector('.archive-detail-pane'),manual=document.querySelector('.manual-comparison'),box=manual?.getBoundingClientRect(),origin=document.querySelector('[data-decision-origin=manual]')?.getBoundingClientRect();return {view:document.querySelector('.archive-detail').dataset.view,pane:pane.scrollTop,expectedPane:expected.pane,list:document.querySelector('.folder-content-list .archive-list').scrollTop,expectedList:expected.list,focused:document.querySelector('.folder-workspace').dataset.focused,expectedFocused:expected.focused,active:document.activeElement?.dataset.decisionOrigin,manual:manual?.open,manualScroll:manual?.scrollTop,expectedManualScroll:expected.manual,originVisible:!!origin&&origin.top>=box.top-1&&origin.bottom<=box.bottom+1,judgment:document.querySelector('[name=comparison-judgment]')?.value};})()`);
      writeFileSync(join(output, `${state.scenario}-return.json`), JSON.stringify(restored, null, 2));
      check(restored.view === mode && Math.abs(restored.pane - restored.expectedPane) <= 1 && restored.list === restored.expectedList && restored.focused === restored.expectedFocused, 'original view, layout and positions');
      check(restored.active === (mode === 'read' ? 'record' : 'manual'), 'original trigger focus');
      if (mode === 'compare') {
        check(restored.manual && restored.judgment === 'Keep the reviewed judgment.', 'manual draft retained');
        check(Math.abs(restored.manualScroll - restored.expectedManualScroll) <= 1 && restored.originVisible, 'worksheet scroll and visible return focus');
      }
      report.push({ scenario: state.scenario, ok: true, restored }); await snapshot(`${state.scenario}-returned`);
      if (mode === 'compare') {
        await click('.comparison-manual-entry'); await settle();
        const columns = await js('[...document.querySelectorAll(".archive-compare-column")].map(node=>node.scrollTop)');
        check(JSON.stringify(columns) === JSON.stringify(answerPositions), 'both answer positions survive worksheet and decision return');
      }
    });
    await run(async () => {
    await open('organization', sample);
    state.step = 'metadata';
    await click('.archive-metadata summary'); await type('[name=archive-note]', 'Keep this note after failure.');
    await activate('.library-metadata-actions button[type=submit]');
    await retry('.library-metadata-actions button[type=submit]', '.archive-metadata [role=status]');
    check(await js('document.querySelector("[name=archive-note]").value==="Keep this note after failure."'), 'metadata retained');
    finish('metadata-focus'); await snapshot(`${state.scenario}-metadata-failure`);
    await enter(); await until('window.recoveryFixture.counts.metadata===2&&!document.querySelector(".library-metadata-actions button[type=button]")', 'explicit metadata retry');
    await click('#organize'); await until('!!document.querySelector("input[type=checkbox]")', 'memberships');
    await click(await label('folderNew', "document.querySelector('.folder-modal')"));
    await type('[name=folder-membership-name]', 'Reviewed folder');
    const labels = await js('({inner:document.querySelector(".folder-create-form button[type=button]").textContent,expected:window.recoveryFixture.copy.folderCancelCreate,outer:[...document.querySelectorAll(".folder-modal button")].filter(node=>node.textContent===window.recoveryFixture.copy.cancel).length})');
    check(labels.inner === labels.expected && labels.outer === 2, 'nested cancellation names');
    state.step = 'create'; await activate('[data-action=create-folder]'); await retry('[data-action=create-folder]', '.folder-modal [role=status]');
    check(await js('document.querySelector("[name=folder-membership-name]").value==="Reviewed folder"'), 'folder name retained');
    finish('create-focus'); await snapshot(`${state.scenario}-create-failure`);
    await enter(); await until('window.recoveryFixture.counts.create===2&&!document.querySelector(".folder-create-form")', 'explicit create retry');
    state.step = 'membership'; await activate('[data-action=save-memberships]'); await retry('[data-action=save-memberships]', '.folder-modal [role=status]');
    check(await js('[...document.querySelectorAll("input[type=checkbox]")].some(node=>node.checked)'), 'membership retained');
    finish('membership-focus'); await enter(); await until('!document.querySelector(".folder-modal")', 'explicit association retry');
    });
    await run(async () => {
    await open('decision', sample); await type('[name=decision-rationale]', 'Keep this rationale after failure.');
    await activate('.decision-detail-actions .library-primary'); await retry('.decision-detail-actions .library-primary', '.archive-status');
    check(await js('document.querySelector("[name=decision-rationale]").value==="Keep this rationale after failure."'), 'decision retained');
    finish('decision-focus'); await snapshot(`${state.scenario}-decision-failure`);
    await enter(); await until('!document.querySelector("[name=decision-title]")&&window.recoveryFixture.counts.decision===2', 'explicit decision retry');
    });
  }
  await run(async () => {
  const sample = { locale: 'en', theme: 'light', width: 1440 };
  await open('organization', sample); await click('.archive-metadata summary'); await type('[name=archive-note]', 'Keep newer focus.');
  await js('window.recoveryFixture.hold()'); await activate('.library-metadata-actions button[type=submit]');
  await click('#outside'); await js('window.recoveryFixture.release()');
  await until('document.querySelector(".library-metadata-actions button[type=submit]").disabled===false', 'late failure');
  check(await js('document.activeElement?.id==="outside"'), 'newer user focus retained'); finish('no-focus-steal'); boundary();
  });
  writeFileSync(join(output, 'report.json'), JSON.stringify({ report, geometry, inputs, failures }, null, 2));
  win.destroy(); app.exit(failures.length ? 1 : 0);
}).catch(async error => {
  if (tools) await tools.failure(error);
  console.error(String(error.message).slice(0, 250)); if (win && !win.isDestroyed()) win.destroy(); app.exit(1);
});
