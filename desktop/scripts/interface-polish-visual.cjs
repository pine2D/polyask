// Real pointer/keyboard input against production components, with local synthetic images.
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const assert = require('node:assert/strict');
  const { join } = require('node:path');
  const { writeFileSync } = require('node:fs');
  const { nativeTheme } = require('electron');
  const failures = [], evidence = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const finish = () => run('document.getAnimations().forEach(animation => animation.finish())');
  const pointer = async (selector, press = true) => {
    win.focus(); win.webContents.focus(); await wait('document.hasFocus()');
    const zoom = win.webContents.getZoomFactor();
    const point = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round((r.x+r.width/2)*${zoom}),y:Math.round((r.y+r.height/2)*${zoom})}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    if (press) win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    return point;
  };
  const release = point => win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  const visualState = selector => run(`(() => { const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return {transform:s.transform,filter:s.filter,background:s.backgroundColor,color:s.color}; })()`);
  const alignment = () => run(`(() => {
    const a=document.querySelector('.page-tab-indicator').getBoundingClientRect();
    const b=document.querySelector('.page-tabs [aria-selected=true]').getBoundingClientRect();
    return {left:a.left-b.left,right:a.right-b.right,top:a.top-b.top,bottom:a.bottom-b.bottom};
  })()`);
  win.webContents.setZoomFactor(1);
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    win.setContentSize(1280, 900);
    await win.loadFile(join(output, 'index.html'), { query: { details: '1', blocked: '1', stress: '1' } });
    await wait('!!document.querySelector(".compare-trigger[aria-disabled=true]")');
    await paint();
    // The workbench entry closes either tab and reopens the sites tab.
    for (const tab of ['sites', 'health']) {
      if (tab === 'health') {
        const point = await pointer('.health-trigger'); release(point);
        await wait('!!document.querySelector("#workspace-health-panel")');
      }
      assert.equal(await run('document.querySelector(".scope-main").getAttribute("aria-expanded")'), 'true');
      const closePoint = await pointer('.scope-main'); release(closePoint);
      await paint();
      assert.equal(await run('!!document.querySelector(".workspace-drawer")'), false, `${theme}: workbench entry must close ${tab}`);
      assert.equal(await run('document.querySelector(".scope-main").getAttribute("aria-expanded")'), 'false');
      const openPoint = await pointer('.scope-main'); release(openPoint);
      await wait('!!document.querySelector("#workspace-sites-panel")');
    }
    for (const open of [true, false, true, false]) {
      const point = await pointer('.health-trigger'); release(point);
      await paint();
      assert.equal(await run('!!document.querySelector("#workspace-health-panel")'), open, `${theme}: health entry must toggle`);
      assert.equal(await run('document.querySelector(".health-trigger").getAttribute("aria-pressed")'), String(open));
    }
    const reopenPoint = await pointer('.scope-main'); release(reopenPoint);
    await wait('!!document.querySelector("#workspace-sites-panel")');
    // Split-button hover backgrounds must follow the frame without clipping focus rings.
    for (const selector of ['.scope-main', '.scope-menu']) {
      await pointer(selector, false); await paint();
      const corners = await run(`(() => {
        const e = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(e);
        const frame = getComputedStyle(e.parentElement);
        const radius = parseFloat(frame.borderTopLeftRadius) - parseFloat(frame.borderTopWidth);
        return { radius, overflow: frame.overflow, hover: e.matches(':hover'),
          values: [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat) };
      })()`);
      const outer = selector === '.scope-main' ? [0, 3] : [1, 2];
      evidence.push({ theme, selector, corners });
      check(corners.hover && corners.values.every((value, index) => value === (outer.includes(index) ? corners.radius : 0)), `${theme}: ${selector} hover corners escape frame`);
      check(corners.overflow === 'visible', `${theme}: split frame clips keyboard focus`);
      await shot(`scope-hover-${theme}-${selector.slice(1)}`);
    }
    // Inert actions keep their reason discoverable but must not acknowledge a press.
    const disabledBefore = await visualState('.compare-trigger');
    const disabledPoint = await pointer('.compare-trigger'); await paint(); await finish();
    const disabledAfter = await visualState('.compare-trigger');
    check(JSON.stringify(disabledBefore) === JSON.stringify(disabledAfter), `${theme}: unavailable action shows press feedback`);
    release(disabledPoint);
    // Deliver the queued click (which dismisses hints) before the explicit focus action.
    await paint();
    await run('document.querySelector(".compare-trigger").blur(); document.querySelector(".compare-trigger").focus()');
    await wait('!!document.querySelector(".feedback-bar [role=tooltip]")');
    check(await run('document.querySelector(".feedback-bar [role=tooltip]").textContent === document.querySelector(".compare-trigger").dataset.hint'), `${theme}: unavailable reason missing`);
    const point = await pointer('.tier-switch button'); await paint(); await finish();
    check((await visualState('.tier-switch button')).transform === 'none', `${theme}: frequent tier action scales on press`);
    release(point);
    for (const page of [0, 1, 2]) {
      await run(`document.querySelector('[data-page="${page}"]').click()`); await paint(); await finish();
      const box = await alignment(); evidence.push({ theme, page, box });
      check(Object.values(box).every(delta => Math.abs(delta) <= 1), `${theme}: page ${page} indicator misses button bounds: ${JSON.stringify(box)}`);
    }
    const imagePoint = await pointer('.image-trigger'); release(imagePoint);
    await wait('document.querySelectorAll(".image-preview img").length === 2');
    await run('Promise.all([...document.querySelectorAll(".image-preview img")].map(image => image.decode()))');
    await paint(); await finish();
    evidence.push({ theme, disabledBefore, disabledAfter });
    await shot(`details-${theme}`);
    await run('document.querySelector(".image-preview button").click()');
    await wait('document.querySelectorAll(".image-preview").length === 1');
    await run('document.querySelector(".image-preview button").click()');
    await wait('!document.querySelector(".image-tray")');
    check(await run('!document.querySelector(".image-count")'), `${theme}: empty attachment count remains`);
  }
  // Slow the existing interruptible page transition to 10%, reverse it, then finish.
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Animation.enable');
    await win.webContents.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 0.1 });
    await run('document.querySelector("#site-page-tab-0").click()'); await paint(); await finish();
    await run('document.querySelector("#site-page-tab-2").click()'); await paint();
    const animations = await run('document.querySelector(".page-tab-indicator").getAnimations().map(a => ({rate:a.playbackRate,property:a.transitionProperty}))');
    const { playbackRate } = await win.webContents.debugger.sendCommand('Animation.getPlaybackRate');
    evidence.push({ slowedTransition: animations, playbackRate });
    check(animations.some(a => a.property === 'transform') && playbackRate === 0.1, 'page transition was not inspected at 10% speed');
    await shot('details-motion-slow');
    await run('document.querySelector("#site-page-tab-1").click()'); await paint(); await finish();
    check(Object.values(await alignment()).every(delta => Math.abs(delta) <= 1), 'interrupted page indicator did not retarget');
    await win.webContents.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 });
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await run('document.querySelector("#site-page-tab-0").click()'); await paint();
    check(await run('document.querySelector(".page-tab-indicator").getAnimations().length === 0'), 'reduced motion still animates page changes');
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await win.webContents.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 });
    win.webContents.debugger.detach();
  }
  writeFileSync(join(output, 'details-report.json'), JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
  console.log('Interface details passed: inert actions, stable press feedback, page alignment/reversal at 10% speed, attachment states, reduced motion.');
};
