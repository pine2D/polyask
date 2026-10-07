// Real Chromium drag and keyboard input against production components, with synthetic sites only.
const assert = require('node:assert/strict');
const { join } = require('node:path');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const order = () => run('[...document.querySelectorAll(".site-choice[data-opened=true]")].map(e => e.dataset.siteKey)');
  const initial = ['claude', 'chatgpt', 'gemini', 'deepseek', 'doubao', 'qianwen', 'kimi', 'yuanbao', 'chatglm'];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'shell', locale } });
    await wait('document.querySelectorAll(".site-choice").length === 9');
    assert.equal(await run('document.querySelectorAll(".site-drag-handle,.site-move-actions button").length'), 0, 'selection mode must hide sorting controls');
    assert.deepEqual(await order(), initial);
    const strokes = await run('[...document.querySelectorAll(".site-choice .selection-mark path")].map(e => getComputedStyle(e).stroke)');
    assert.ok(strokes.every(stroke => stroke !== 'transparent' && stroke !== 'rgba(0, 0, 0, 0)'), `${locale}: selected checkbox marks must be visible`);
    await run('document.querySelector("[data-sites-mode-toggle]").click()');
    await wait('document.querySelectorAll(".site-drag-handle").length === 9');
    await run('document.querySelector("[data-site-key=chatgpt] .site-drag-handle").focus()');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
    await wait('document.querySelector(".site-choice").dataset.siteKey === "chatgpt"');
    assert.deepEqual(await order(), ['chatgpt', 'claude', ...initial.slice(2)]);
    assert.equal(await run('document.activeElement.closest("[data-site-key]").dataset.siteKey'), 'chatgpt');
    await run('document.querySelector("[data-site-key=chatgpt] [data-move=down]").click()');
    await wait('document.querySelector(".site-choice").dataset.siteKey === "claude"');
    await paint();
    const overflow = await run('[...document.querySelectorAll(".site-choice,.site-order-hint")].some(e => e.scrollWidth > e.clientWidth + 2)');
    assert.equal(overflow, false, `${locale}: site order controls overflow`);
    assert.equal(await run('document.querySelector("[data-site-key=claude] [data-move=up]").disabled'), true);
    assert.equal(await run('document.querySelector("[data-site-key=chatglm] [data-move=down]").disabled'), true);
  }

  // Intercept a native drag started by mouse input, then deliver its real data to the target.
  win.webContents.debugger.attach('1.3');
  const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params);
  let dragData;
  const onMessage = (_event, method, params) => { if (method === 'Input.dragIntercepted') dragData = params.data; };
  win.webContents.debugger.on('message', onMessage);
  try {
    await cdp('Input.setInterceptDrags', { enabled: true });
    const rect = selector => run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const source = await rect('[data-site-key=claude] .site-drag-handle');
    const target = await rect('[data-site-key=gemini]');
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...source });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...source, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 6; step++) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x, y: source.y + step * 6, button: 'left', buttons: 1 });
    }
    const deadline = Date.now() + 3000;
    while (!dragData && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(dragData, 'mouse input must initiate a native Chromium drag');
    for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp('Input.dispatchDragEvent', { type, ...target, y: target.y + 4, data: dragData });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 });
    await wait('document.querySelector(".site-choice").dataset.siteKey === "chatgpt"');
    assert.deepEqual(await order(), ['chatgpt', 'gemini', 'claude', ...initial.slice(3)]);
    const pageLabel = await run('document.querySelector(".page-tabs button").getAttribute("aria-label")');
    assert.ok(pageLabel.indexOf('ChatGPT') < pageLabel.indexOf('Gemini') && pageLabel.indexOf('Gemini') < pageLabel.indexOf('Claude'), 'page accessibility details must follow site order');
    await shot('site-order-drag');
    win.webContents.setZoomFactor(1.5);
    await paint();
    assert.equal(await run('[...document.querySelectorAll(".site-choice")].some(e => e.scrollWidth > e.clientWidth + 2)'), false, '150% site controls overflow');
    await shot('site-order-zoom');
    win.webContents.setZoomFactor(1);
  } finally {
    await cdp('Input.setInterceptDrags', { enabled: false });
    win.webContents.debugger.removeListener('message', onMessage);
    win.webContents.debugger.detach();
  }
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'shell', locale } });
    await wait('document.querySelectorAll(".site-choice").length === 9 && document.querySelector(".send-count").textContent === "9"');
    await run('document.querySelector("[data-site-key=claude] input[name=scope-sites]").click()');
    await wait('document.querySelector(".send-count").textContent === "8"');
    assert.equal(await run('document.querySelector(".app-shell").dataset.opened'), initial.join(','), 'excluding a site must retain open-page order');
    assert.equal(await run('document.querySelectorAll(".tile-frame").length'), 2, 'exclusion must retain both laid out shell tiles');
    assert.equal(await run('document.querySelector(".tile-header input[value=claude]").checked'), false, 'page header must reflect participation');
    await run('document.querySelectorAll(".scope-preset")[1].click()');
    await wait('document.querySelector(".send-count").textContent === "0"');
    assert.equal(await run('document.querySelector(".send").disabled'), true, 'zero participation disables sending');
    assert.equal(await run('document.querySelector(".app-shell").dataset.opened'), initial.join(','), 'clear participation must retain every open page');
    await run('document.querySelectorAll(".scope-preset")[0].click()');
    await wait('document.querySelector(".send-count").textContent === "9"');
    await run('document.querySelector("[data-close-site=kimi]").click()');
    await wait('document.querySelector(".site-page-close-confirm") !== null');
    assert.equal(await run('document.activeElement === document.querySelector(".folder-modal header button")'), true, 'close defaults to cancel');
    await run('document.querySelector(".folder-modal header button").click()');
    await wait('document.querySelector("[role=dialog]") === null');
    assert.equal(await run('document.querySelector(".app-shell").dataset.opened'), initial.join(','), 'cancel must not close the page');
    await run('document.querySelector(".scope-main").click()');
    await wait('document.querySelector("[data-close-site=kimi]") !== null');
    await run('document.querySelector("[data-close-site=kimi]").click()');
    await wait('document.querySelector(".site-page-close-confirm") !== null');
    await run('document.querySelector(".site-page-close-confirm").click()');
    await wait('document.querySelector("[role=dialog]") === null && document.querySelector(".send-count").textContent === "8"');
    assert.equal(await run('document.querySelector(".app-shell").dataset.opened'), initial.filter(site => site !== 'kimi').join(','), 'confirmed close removes only its open page');
    await shot(`site-participation-${locale}`);
  }
  await win.loadFile(join(output, 'index.html'), { query: { surface: 'shell', locale: 'en', deferPageSelection: '1' } });
  await wait('document.querySelectorAll(".site-choice").length === 9');
  await run('document.querySelector("[data-sites-mode-toggle]").click()');
  await wait('document.querySelector("[data-site-key=claude] .site-drag-handle") !== null');
  await run('document.querySelector("[data-site-key=claude] .site-drag-handle").focus()');
  const nativeArrow = keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const finishSelection = async () => {
    await run('document.dispatchEvent(new Event("fixture:finish-operation"))');
    await wait('!document.querySelector("[data-site-key=claude] .site-drag-handle").disabled');
  };
  nativeArrow('Down');
  await wait('document.querySelector("[data-site-key=claude] .site-drag-handle").disabled');
  await finishSelection();
  assert.equal(await run('document.activeElement.closest("[data-site-key]")?.dataset.siteKey ?? null'), 'claude', 'deferred selection ACK must restore the keyboard handle');
  nativeArrow('Up');
  await wait('document.querySelector("[data-site-key=claude] .site-drag-handle").disabled');
  await finishSelection();
  assert.deepEqual(await order(), initial, 'the next native Arrow must continue from the acknowledged keyboard cursor');
  nativeArrow('Down');
  await wait('document.querySelector("[data-site-key=claude] .site-drag-handle").disabled');
  await run('document.querySelector("textarea").focus()');
  await finishSelection();
  assert.equal(await run('document.activeElement === document.querySelector("textarea")'), true, 'selection ACK must not steal later prompt focus');
  console.log('Site order UI passed: three locales, keyboard, move buttons, native drag, page labels and 150% zoom.');
  console.log('Site participation UI passed: three locales, retained open-page order and tiles, zero-send guard, cancel-first close and confirmed close. Synthetic sites only.');
  console.log('Deferred selection UI passed: pending-disable interval, restored keyboard cursor and no focus theft.');
};
