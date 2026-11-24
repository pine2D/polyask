const assert = require('node:assert/strict');
const { nativeImage, nativeTheme } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const wc = win.webContents;
  const failures = [], reports = [];
  const inspect = fn => run('(' + fn + ')()');
  const field = () => inspect(() => {
    const t = document.querySelector('textarea[name=prompt]'), group = t.parentElement;
    const rect = e => e.getBoundingClientRect().toJSON();
    const css = getComputedStyle(t);
    const border = parseFloat(css.borderRightWidth);
    return { editor: rect(t), group: rect(group), toggle: rect(group.querySelector('button')), border,
      focused: document.activeElement === t, expanded: group.dataset.expanded === 'true',
      outerBorder: parseFloat(getComputedStyle(group).borderRightWidth), outerScroll: group.scrollHeight - group.clientHeight,
      gutter: t.offsetWidth - t.clientWidth - border - parseFloat(css.borderLeftWidth),
      overflow: t.scrollHeight - t.clientHeight, scroll: t.scrollTop, clientHeight: t.clientHeight, lineHeight: parseFloat(css.lineHeight) };
  });
  const mouse = (type, x, y, extra = {}) => {
    const zoom = wc.getZoomFactor();
    wc.sendInputEvent({ type, x: Math.round(x * zoom), y: Math.round(y * zoom), ...extra });
  };
  const click = async (x, y) => {
    mouse('mouseMove', x, y);
    mouse('mouseDown', x, y, { button: 'left', clickCount: 1 });
    mouse('mouseUp', x, y, { button: 'left', clickCount: 1 });
    await paint();
  };
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers });
    await paint();
  };
  const draft = Array.from({ length: 42 }, (_, i) => '第 ' + (i + 1) + ' 行  /  Long draft').join('\n');
  win.setContentSize(960, 680);
  for (const [locale, density, skin, scheme, zoom] of [
    ['zh-CN', 'compact', 'proof', 'light', 1], ['en', 'comfortable', 'platinum', 'light', 1],
    ['zh-TW', 'comfortable', 'proof', 'dark', 1.5], ['en', 'compact', 'platinum', 'dark', 2],
    ['zh-TW', 'comfortable', 'proof', 'dark', 2]
  ]) {
    const label = [locale, density, skin, scheme, zoom].join('-');
    const check = (ok, issue) => { if (!ok) failures.push(label + ': ' + issue); };
    nativeTheme.themeSource = scheme;
    await win.loadFile(join(output, 'index.html'), { query: { locale, density, skin, stress: '1', progress: '1', preview: locale === 'zh-TW' ? '1' : '0' } });
    wc.setZoomFactor(zoom); win.focus(); wc.focus();
    await wait('document.hasFocus() && !!document.querySelector("textarea[name=prompt]")');
    await paint();
    const closed = await field();
    const report = { locale, density, skin, scheme, zoom, dpr: await run('devicePixelRatio'), closed };
    reports.push(report);
    check(closed.editor.width >= 320, 'editable width ' + closed.editor.width);
    check(Math.abs(closed.clientHeight - closed.lineHeight) <= 1, 'the collapsed editor should show one full line');
    // This strip used to look editable while the pointer landed on its non-focusable parent.
    await click(closed.editor.left + 18, closed.group.bottom - 2);
    let opened = await field();
    check(opened.focused && opened.expanded, 'bottom edge of the collapsed field did not open the editor');
    if (!opened.focused) await click(closed.editor.left + 18, closed.editor.top + 6);
    await key('a', ['control']); await key('Backspace');
    await wait('document.querySelector("textarea").value === ""');
    check((await field()).gutter <= 1, 'empty editor reserves a scrollbar');
    if (skin === 'proof' && scheme === 'light') await shot('composer-empty');
    await wc.insertText('Short'); await paint();
    check((await field()).overflow <= 1, 'short draft overflows');
    await key('a', ['control']); await wc.insertText(draft); await paint();
    opened = await field();
    report.opened = opened;
    check(opened.border > 0 && opened.outerBorder === 0, 'the visible frame must belong to the textarea');
    check(Math.abs(opened.group.height - opened.editor.height) < 1 && opened.outerScroll <= 1, 'the outer group clips or scrolls the editor');
    check(opened.editor.right < opened.toggle.left, 'toggle overlaps the framed editor');
    check(opened.overflow > 100 && opened.gutter > 0, 'long draft did not expose a track');
    if (skin === 'proof' && scheme === 'light') {
      await inspect(() => { const t = document.querySelector('textarea'); t.setSelectionRange(0, 0); t.scrollTop = 0; });
      await paint();
      const { editor, border, gutter } = opened;
      const x = editor.right - border - gutter / 2, y = editor.top + border + gutter + 4;
      mouse('mouseMove', x, y); mouse('mouseDown', x, y, { button: 'left', clickCount: 1 }); await paint();
      const down = await field();
      for (const delta of [5, 15, 28, 42]) { mouse('mouseMove', x, y + delta, { modifiers: ['leftButtonDown'] }); await paint(); }
      mouse('mouseUp', x, y + 42, { button: 'left', clickCount: 1 }); await paint();
      const drag = await field();
      report.dragScroll = drag.scroll;
      check(down.scroll <= 1 && drag.scroll > 40 && drag.expanded && drag.focused, 'dragging the thumb must scroll the focused editor');
      mouse('mouseMove', editor.left + 40, editor.top + 40);
      mouse('mouseWheel', editor.left + 40, editor.top + 40, { deltaX: 0, deltaY: -2000, canScroll: true });
      await wait('(()=>{const t=document.querySelector("textarea");return t.scrollTop+t.clientHeight>=t.scrollHeight-1})()');
    }
    await shot('composer-long-' + label);
    const area = opened.editor, zoomNow = wc.getZoomFactor();
    const crop = await wc.capturePage({ x: Math.floor((area.right - 110) * zoomNow), y: Math.max(0, Math.floor((area.top - 5) * zoomNow)),
      width: Math.ceil((opened.toggle.right - area.right + 120) * zoomNow), height: Math.ceil((area.height + 12) * zoomNow) });
    const png = crop.toPNG({ scaleFactor: Math.max(...crop.getScaleFactors()) });
    writeFileSync(join(output, 'composer-edge-' + label + '.png'), png);
    if (skin === 'proof' && zoom === 1) {
      // Compare the inner focus line on both sides of the scrollbar. Chromium paints its track above inset shadows.
      const frame = nativeImage.createFromBuffer(png), size = frame.getSize(), bitmap = frame.toBitmap();
      const left = Math.floor(area.right - 110), top = Math.max(0, Math.floor(area.top - 5));
      const scale = size.width / Math.ceil(opened.toggle.right - area.right + 120);
      const pixel = (x, y) => {
        const offset = 4 * (Math.floor((y - top) * scale) * size.width + Math.floor((x - left) * scale));
        return bitmap.subarray(offset, offset + 3);
      };
      for (const y of [area.top + 1.5, area.bottom - 1.5]) {
        const inside = pixel(area.right - 32, y), track = pixel(area.right - opened.gutter / 2, y);
        // At fractional device scales the same antialiased stroke blends against two different backgrounds.
        check(inside.every((channel, i) => Math.abs(channel - track[i]) <= 3), 'focus line breaks at the native scrollbar');
      }
    }

    if (zoom === 2) {
      await run('document.querySelector("[name=run-progress-details]").click()');
      await wait('document.querySelector(".run-progress").dataset.expanded==="true"');
      const facts = await inspect(() => {
        const e = document.querySelector('.run-progress-facts'), s = document.querySelector('.feedback-bar');
        const r = e.getBoundingClientRect(), bar = s.getBoundingClientRect();
        const actions = [...s.querySelectorAll('button')].map(button => button.getBoundingClientRect()).filter(box => box.width);
        e.focus();
        return { overflow: e.scrollWidth - e.clientWidth, track: e.offsetHeight - e.clientHeight,
          notice: s.dataset.hasNotice === 'true',
          visibleWidth: e.clientWidth, firstCount: e.firstElementChild.offsetWidth,
          buttonsFit: actions.every((box, i) => box.left >= (actions[i - 1]?.right ?? bar.left) - 1 && box.right <= bar.right + 1),
          fits: r.top >= bar.top - 1 && r.bottom <= bar.bottom + 1 };
      });
      report.footer = facts;
      check(facts.overflow > 0 && facts.track === 0 && facts.fits, 'progress counters must fit the footer during horizontal overflow ' + JSON.stringify(facts));
      check(facts.notice && facts.visibleWidth >= facts.firstCount && facts.buttonsFit, 'progress counters and footer actions need separate visible space ' + JSON.stringify(facts));
      await shot('composer-progress-' + label);
      await key('Right'); await wait('document.querySelector(".run-progress-facts").scrollLeft > 0');
    }
  }
  wc.setZoomFactor(1);
  writeFileSync(join(output, 'composer-scroll-report.json'), JSON.stringify(reports, null, 2));
  assert.deepEqual(failures, [], 'native composer editing and footer scroll geometry');
};
