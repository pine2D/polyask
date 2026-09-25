// Linux Chromium 验证平台分支与 DOM 交互，不冒充对应系统的原生验收。
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const assert = require('node:assert/strict');
  const { join } = require('node:path');
  win.webContents.setZoomFactor(1);
  win.setContentSize(960, 680);
  const key = keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  for (const platform of ['win32', 'darwin', 'linux']) {
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'native', platform } });
    await wait('!!document.querySelector("#open-dialog")');
    await run('window.addEventListener("keydown", event => { if (event.key === "Escape") document.body.dataset.hostClosed = "true"; })');
    await run('document.querySelector("#open-dialog").focus(); document.querySelector("#open-dialog").click()');
    await wait('!!document.querySelector(".confirm-dialog")');
    const state = await run(`(() => {
      const buttons = [...document.querySelectorAll('.confirm-actions button')];
      return { primaryFirst: buttons[0].classList.contains('primary'),
        cancelFocused: document.activeElement === buttons.find(b => !b.classList.contains('primary')),
        font: getComputedStyle(document.body).fontFamily,
        buttonSelection: getComputedStyle(buttons[0]).userSelect,
        contentSelection: getComputedStyle(document.querySelector('#selectable-content')).userSelect };
    })()`);
    assert.equal(state.primaryFirst, platform === 'win32');
    assert.equal(state.cancelFocused, true);
    assert.equal(state.buttonSelection, 'none');
    assert.notEqual(state.contentSelection, 'none');
    assert.ok(state.font.includes(platform === 'win32' ? 'Segoe UI Variable' : platform === 'darwin' ? '-apple-system' : 'system-ui'));
    for (let i = 0; i < 5; i++) {
      key('Tab');
      assert.equal(await run('document.querySelector(".confirm-dialog").contains(document.activeElement)'), true);
    }
    await shot(`native-${platform}`);
    const imeAllowed = await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", isComposing:true, bubbles:true, cancelable:true}))');
    assert.equal(imeAllowed, true, 'IME default handling must be preserved');
    assert.equal(await run('!!document.querySelector(".confirm-dialog")'), true);
    assert.notEqual(await run('document.body.dataset.hostClosed'), 'true', 'IME Escape must not close the host surface');
    key('Escape');
    await wait('!document.querySelector(".confirm-dialog")');
    assert.equal(await run('document.activeElement.id'), 'open-dialog');
    assert.notEqual(await run('document.body.dataset.confirmed'), 'true');
  }
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'forced-colors', value: 'active' }
    ] });
    await paint();
    await run('document.querySelector("#close-pane").click()');
    await wait('!document.querySelector("#presence-pane")');
    await run('document.querySelector("#open-dialog").click()');
    await wait('!!document.querySelector(".confirm-dialog")');
    const contrast = await run(`(() => {
      const probe = document.createElement('span'); probe.style.color = 'Highlight'; document.body.append(probe);
      const expected = getComputedStyle(probe).color; probe.remove();
      const cancel = document.querySelector('.confirm-actions button:not(.primary)'); cancel.focus();
      const primary = getComputedStyle(document.querySelector('.confirm-actions .primary'));
      return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        forced: matchMedia('(forced-colors: active)').matches, expected,
        primaryAdjustment: primary.forcedColorAdjust, primaryColor: primary.color, primaryBackground: primary.backgroundColor,
        outline: getComputedStyle(cancel).outlineColor, transition: getComputedStyle(cancel).transitionDuration };
    })()`);
    assert.equal(contrast.reduced, true); assert.equal(contrast.forced, true);
    assert.equal(contrast.outline, contrast.expected); assert.equal(contrast.transition, '0s');
    assert.equal(contrast.primaryAdjustment, 'none');
    assert.notEqual(contrast.primaryColor, contrast.primaryBackground);
    await shot('native-forced-colors');
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'shell', sending: '1' } });
    await wait('!!document.querySelector(".cancel.primary-action")');
    assert.equal(await run('getComputedStyle(document.querySelector(".cancel.primary-action")).forcedColorAdjust'), 'auto', 'stop button must follow the system forced colors');
  } finally { win.webContents.debugger.detach(); }
  console.log('Native UI passed: three platform branches, cancel focus, Tab containment, IME Escape, focus restoration, reduced motion, forced colors.');
};
