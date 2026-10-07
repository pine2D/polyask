const assert = require('node:assert/strict');
const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
const read = (win, expression) => win.webContents.executeJavaScript(expression);
async function wait(win, expression, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await read(win, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timeout: ${label}`);
}
async function click(win, selector) {
  await wait(win, `!!document.querySelector(${JSON.stringify(selector)})`, 'guide control');
  const point = await read(win, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:'center'}); const r = element.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}; })()`);
  assert.equal(point.width >= 24 && point.height >= 24, true, `visible native target ${selector}`);
  win.focus(); await wait(win, 'document.hasFocus()', 'native window focus');
  for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1,
    x: Math.round(point.x), y: Math.round(point.y) });
}
const preference = 'JSON.parse(localStorage.getItem("polyask.display") || "null")?.workbenchGuide ?? null';
async function fresh(win, locale) {
  await win.loadFile(join(output, 'index.html'), { query: { locale } });
  await read(win, 'localStorage.removeItem("polyask.display")');
  await win.loadFile(join(output, 'index.html'), { query: { locale } });
  await wait(win, 'document.querySelector("[data-workbench-guide=invite]") !== null', 'first local invitation');
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 960, height: 800, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  for (const width of [960, 1280]) for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    win.setSize(width, 800);
    await fresh(win, locale);
    assert.deepEqual(await read(win, 'window.guideFixture.result()'), { checked: [], focused: [], commands: [], navigations: [], failures: 0 });
    assert.equal(await read(win, 'Math.round(document.querySelector(".workspace-progress").getBoundingClientRect().height)'), 32);
    assert.equal(await read(win, '[...document.querySelectorAll(".workbench-guide-invite")].some(e=>e.scrollWidth>e.clientWidth+2)'), false);
    await click(win, '[data-guide-action="open"]');
    await wait(win, 'document.querySelector("[data-guide-action=check]") !== null', 'two-site details');
    await click(win, '[data-guide-action="check"]');
    await wait(win, 'window.guideFixture.result().checked.length === 1', 'explicit health request');
    assert.deepEqual(await read(win, 'window.guideFixture.result().checked'), [['claude', 'kimi']]);
    await click(win, '[data-guide-focus-site="kimi"]');
    await wait(win, 'window.guideFixture.result().focused.length === 1', 'explicit named site');
    assert.deepEqual(await read(win, 'window.guideFixture.result().focused'), ['kimi']);
    await click(win, '.workbench-guide-panel header button');
    await wait(win, 'document.querySelector("[data-workbench-guide=invite]") === null', 'session dismissal');
    assert.deepEqual(await read(win, preference), { version: 1, disposition: 'dismissed' });
    await win.loadFile(join(output, 'index.html'), { query: { locale } });
    await wait(win, 'document.querySelector("[data-guide-fixture=manual]") !== null', 'reloaded guide fixture');
    assert.equal(await read(win, 'document.querySelector("[data-workbench-guide=invite]") === null'), true);
    await click(win, '[data-guide-fixture="manual"]');
    await wait(win, 'document.querySelectorAll(".getting-started-step").length === 4', 'permanent manual guide');
    assert.deepEqual(await read(win, 'window.guideFixture.result().commands'), []);
    await fresh(win, locale);
    await click(win, '[data-guide-fixture="partial"]');
    await wait(win, 'document.querySelector("[data-guide-action=read]") !== null', 'readable partial copies');
    await click(win, '[data-guide-action="read"]');
    await wait(win, 'document.querySelector("[data-guide-fixture-reader=loading]") !== null', 'explicit read request');
    assert.equal(await read(win, preference), null, 'clicking read must not mark completed');
    const request = await read(win, 'window.guideFixture.result().navigations[0]');
    assert.equal(request.questionId, 'fixture-question'); assert.equal(request.runId, 'fixture-run');
    assert.equal(request.mode, 'read'); assert.deepEqual(request.answerIds, ['claude-1']);
    await read(win, 'document.dispatchEvent(new Event("fixture:guide-read-ready"))');
    await wait(win, 'document.querySelector("[data-guide-fixture-reader=ready]") !== null', 'positive saved-reader ready');
    assert.deepEqual(await read(win, preference), { version: 1, disposition: 'completed' });
    assert.equal(await read(win, 'document.querySelector("[data-guide-fixture-reader=ready]").textContent.length > 0'), true);
    console.log(JSON.stringify({ locale, width, localDismissReload: true, explicitHealth: ['claude', 'kimi'], partialReadAck: true, syntheticSavedCopy: true }));
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
