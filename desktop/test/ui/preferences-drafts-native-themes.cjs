const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

// Runs only in the preferences harness's isolated, network-blocked profile.
module.exports = async ({ services, database, preferences, handle, win, views, manager, tools, dispatch, locale, output, nativeTheme }) => {
  const { run, wait, click, type, pause } = tools;
  const copy = services.getCopy(locale);
  const sampleProcesses = require('./native-process-boundary.cjs').processBoundary(require('electron').app, output);
  const paint = () => run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const capture = async name => {
    await paint();
    const path = join(output, 'theme-' + name + '.png');
    if (process.platform === 'linux') {
      // Xvfb window composition includes the two site views and the independent topmost menu.
      const id = win.getNativeWindowHandle().readUInt32LE();
      execFileSync('import', ['-window', String(id), path], { timeout: 5000 });
    } else writeFileSync(path, (await win.capturePage()).toPNG());
  };
  const themeIs = id => wait('document.documentElement.dataset.uiTheme===' + JSON.stringify(id));
  const settings = async () => { dispatch('open-settings'); await wait('!!document.querySelector(".settings-workspace")'); };
  const choose = async id => {
    const selector = 'input[name=settings-theme][value=' + id + ']';
    await click(selector);
    await themeIs(id);
    await wait('document.querySelector(' + JSON.stringify(selector) + ').checked');
  };
  const sites = async () => {
    await click('.settings-toolbar .panel-close');
    await wait('!!document.querySelector("textarea[name=prompt]")');
  };
  const checkPressed = async (selector, expectedColor) => {
    const target = 'document.querySelector(' + JSON.stringify(selector) + ')';
    const point = await run(`(() => { const r=${target}.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) }; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    await wait(target + '.matches(":active")');
    const matches = await run(`(() => {
      const node=${target}, probe=document.createElement('span'); node.append(probe);
      probe.style.color='var(${expectedColor})';
      const style=getComputedStyle(node), key=node.querySelector('kbd');
      const ok=style.color===getComputedStyle(probe).color && style.boxShadow==='none' && (!key || getComputedStyle(key).color===style.color);
      probe.remove(); return ok;
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 80 });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: 4, y: 80 });
    assert.equal(matches, true, selector + ' pressed contrast and shadow');
  };
  handle('window-chrome-state', () => ({ focused: true, maximized: false, fullScreen: false }));
  handle('page-zoom-get', () => 1);
  handle('question-legacy', () => ({ items: [], cursor: null }));
  let historyError = false;
  handle('question-list', query => {
    if (historyError) throw Error('question_load_failed');
    return database.questions.search(query ?? {});
  });
  handle('question-get', value => database.questions.detail(value.questionId, value.answerId));
  let popup;
  services.setPlatinumPopupObserver({ onOpen: info => { popup = info.view; }, onClose: () => { popup = null; } });
  handle('show-command-menu', ids => services.showCommandMenu(win, ids, copy));
  const pending = Promise.withResolvers();
  const coordinator = new services.BroadcastCoordinator();
  let dispatches = 0;
  handle('broadcast', request => coordinator.send(request, async () => {
    dispatches++;
    await pending.promise;
    return { ok: true };
  }, 44000));

  const question = '并排阅读两份报告时，怎样核对结论的依据？';
  const answers = [
    ['先对齐比较口径', '记录两份报告采用的时间范围、数据来源和统计单位。口径一致后，再比较数字与结论。', '逐段核对原文', '把关键段落并排放置，分别标出作者的判断和支撑它的证据。'],
    ['从同一个问题出发', '先写下要验证的问题。阅读时分别摘出两份报告的直接回答，并保留上下文。', '保留差异', '对看似矛盾的结论，记录各自成立的条件。证据不足的地方留待核实。']
  ];
  const ids = views.map(view => view.webContents.id);
  for (const [i, view] of views.entries()) {
    const a = answers[i];
    const html = '<meta charset="utf-8"><style>:root{color-scheme:light dark}body{max-width:42rem;margin:0 auto;padding:4vw;font:16px/1.8 system-ui;color:CanvasText;background:Canvas}h2{font-size:22px}h3{font-size:17px}</style>' +
      '<h2>' + a[0] + '</h2><p>' + a[1] + '</p><h3>' + a[2] + '</h3><p>' + a[3] + '</p>';
    await view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }
  win.setContentSize(1440, 800);
  nativeTheme.themeSource = 'light';
  await win.loadFile(join(output, 'index.html'));
  win.focus(); win.webContents.focus();
  await wait('!!document.querySelector(".more-trigger")');
  await themeIs('platinum');

  // Switch with a real coordinator pending and a live editing selection in the same renderer.
  await type('textarea[name=prompt]', question);
  await run('window.themeRun = window.polyask.broadcast({runId:"theme-native",text:"local fixture",sites:["claude","kimi"],images:[],tier:null}); true');
  await run('window.themeInput = document.activeElement; window.themeInput.setSelectionRange(1, 4)');
  preferences.set('uiTheme', 'minimal');
  await themeIs('minimal');
  assert.equal(await run('document.activeElement===window.themeInput && themeInput.selectionStart===1 && themeInput.selectionEnd===4'), true);
  pending.resolve();
  assert.deepEqual((await run('window.themeRun')).map(r => r.ok), [true, true]);
  assert.equal(dispatches, 2);
  assert.deepEqual(views.map(view => view.webContents.id), ids);
  assert.equal(await run('window.themeInput.value'), question);
  await run('document.querySelector("textarea[name=prompt]").blur()');

  const detail = services.savedDetail;
  for (const skin of ['platinum', 'minimal']) {
    await settings(); await choose(skin); await sites();
    assert.equal(await run('document.querySelector(".compare-trigger").getAttribute("aria-disabled")'), 'true');
    assert.equal(await run('getComputedStyle(document.querySelector(".window-stripe")).visibility'), skin === 'minimal' ? 'hidden' : 'visible');
    await capture(skin + '-workspace');
    if (skin === 'minimal') {
      await checkPressed('.command-bar .send', '--on-accent');
      await checkPressed('.window-tbox:not(.is-close)', '--text');
    }
    await click('.more-trigger');
    for (let tries = 0; tries < 80 && !popup; tries++) await pause(25);
    assert.ok(popup, 'cross-view menu opened');
    assert.equal(win.contentView.children.at(-1) === popup, true);
    const menu = popup.webContents;
    assert.equal(await menu.executeJavaScript('document.documentElement.dataset.uiTheme'), skin);
    assert.equal(await menu.executeJavaScript('getComputedStyle(document.querySelector("#menu")).borderRadius'), skin === 'minimal' ? '6px' : '0px');
    const activeItem = () => menu.executeJavaScript('document.querySelector("[data-active=true]")?.textContent');
    const active = await menu.executeJavaScript('Array.from(document.querySelectorAll(".plat-item:not([aria-disabled=true])")).at(-1).textContent');
    for (const type of ['keyDown', 'keyUp']) menu.sendInputEvent({ type, keyCode: 'End' });
    for (let tries = 0; tries < 80 && await activeItem() !== active; tries++) await pause(15);
    assert.equal(await activeItem(), active, 'native keyboard selection settled before switching skins');
    sampleProcesses();
    await capture(skin + '-menu');
    const other = skin === 'minimal' ? 'platinum' : 'minimal';
    preferences.set('uiTheme', other);
    await themeIs(other);
    assert.equal(await menu.executeJavaScript('document.documentElement.dataset.uiTheme'), other);
    assert.equal(await activeItem(), active);
    menu.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    for (let tries = 0; tries < 80 && popup; tries++) await pause(25);
    assert.equal(popup === null, true);
    preferences.set('uiTheme', skin); await themeIs(skin);

    dispatch('open-question-history');
    await wait('!!document.querySelector(".question-history")');
    if (skin === 'platinum') {
      await wait('!!document.querySelector(".question-empty") && !document.querySelector(".question-scroll[aria-busy=true]")');
      for (const id of ['minimal', 'platinum']) {
        preferences.set('uiTheme', id); await themeIs(id);
        assert.equal(await run('!!document.querySelector(".question-empty")'), true);
        await capture(id + '-history-empty');
      }
      database.questions.put({ ...detail.question, text: question });
      for (const [i, answer] of detail.answers.entries()) database.questions.putAnswer({ ...answer,
        id: services.questionAnswerId(answer.questionId, answer.site, answer.attempt),
        answerMarkdown: '## ' + answers[i % 2][0] + '\n\n' + answers[i % 2][1] + '\n\n### ' + answers[i % 2][2] + '\n\n' + answers[i % 2][3] });
      await click('.question-header .panel-close');
      await wait('!document.querySelector(".question-history")');
      dispatch('open-question-history');
    }
    await wait('!!document.querySelector(".question-main")');
    await click('.question-main');
    await wait('!!document.querySelector(".question-answer .markdown-preview")');
    await capture(skin + '-history');
    await click('.question-header .panel-close');
    await wait('!document.querySelector(".question-history")');
  }
  historyError = true;
  dispatch('open-question-history');
  await wait('!!document.querySelector(".question-notice[role=alert]")');
  for (const id of ['platinum', 'minimal']) {
    preferences.set('uiTheme', id); await themeIs(id);
    assert.equal(await run('!!document.querySelector(".question-notice[role=alert]")'), true);
    await capture(id + '-history-error');
  }
  await click('.question-header .panel-close');
  await wait('!document.querySelector(".question-history")');

  const matrix = [];
  await settings();
  win.setContentSize(960, 680);
  for (const skin of ['minimal', 'platinum']) {
    await choose(skin);
    for (const scheme of ['light', 'dark']) for (const density of ['compact', 'comfortable']) for (const zoom of [1, 1.5, 2]) {
      nativeTheme.themeSource = scheme;
      preferences.setDisplay({ density, siteScale: 0.9 });
      win.webContents.setZoomFactor(zoom);
      await wait(`document.documentElement.dataset.density==='${density}' && innerWidth===${960 / zoom} && matchMedia('(prefers-color-scheme: ${scheme})').matches`);
      // Real backward tab scrolls the selected option into the clipped settings viewport at 200%.
      await run('document.querySelector("input[name=settings-density]:checked").focus()');
      for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode: 'Tab', modifiers: ['shift'] });
      await wait('document.activeElement===document.querySelector("input[name=settings-theme]:checked")');
      await paint();
      const metrics = await run(`(() => {
        const input = document.querySelector('input[name=settings-theme]:checked');
        const label = input.closest('label'), rect = label.getBoundingClientRect(), body = document.querySelector('.settings-body');
        const hit = document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2);
        return { id: input.value, focused: input.matches(':focus-visible'), visible: label.contains(hit),
          scrollColor: getComputedStyle(body).scrollbarColor, radioShadow: getComputedStyle(input).boxShadow,
          overflow: body.scrollWidth-body.clientWidth, width: innerWidth };
      })()`);
      assert.equal(metrics.id, skin); assert.equal(metrics.focused, true);
      assert.equal(metrics.visible, true); assert.ok(metrics.overflow <= 1);
      assert.equal(metrics.radioShadow === 'none', skin === 'minimal');
      assert.equal(metrics.scrollColor !== 'auto', skin === 'minimal');
      matrix.push({ skin, scheme, density, zoom, ...metrics });
      if (zoom > 1 && density === 'comfortable') await capture([skin, scheme, 'settings-' + zoom * 100].join('-'));
    }
  }
  assert.equal(matrix.length, 24);
  writeFileSync(join(output, 'theme-matrix.json'), JSON.stringify(matrix, null, 2));
  win.webContents.debugger.attach();
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await wait("matchMedia('(forced-colors: active)').matches");
    for (const skin of ['minimal', 'platinum']) {
      await choose(skin);
      assert.equal(await run('getComputedStyle(document.querySelector("input[name=settings-theme]:checked")).appearance'), 'auto');
    }
  } finally { win.webContents.debugger.detach(); }
  services.setPlatinumPopupObserver(null);
  console.log('Theme evidence: ' + output);
};
