// Isolated settings interactions: never calls a real account or deletes user data.
module.exports = async ({ win, output, run, wait, paint, shot }) => {
  const assert = require('node:assert/strict');
  const { join } = require('node:path');
  const failures = [];
  win.webContents.setZoomFactor(1);
  win.setContentSize(1280, 900);
  await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale: 'zh-CN' } });
  await wait('!!document.querySelector(".settings-workspace")');
  await run('document.querySelector("[data-settings-section=data]").click()');
  await run('document.querySelector(".danger-zone input").focus()');
  for (const event of ['{key:"Escape",isComposing:true}', '{key:"Escape",keyCode:229}']) {
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {...${event}, bubbles:true}))`);
    if (await run('document.body.dataset.settingsClosed === "true"')) failures.push(`IME closed settings: ${event}`);
    await run('delete document.body.dataset.settingsClosed');
  }
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
  assert.equal(await run('document.body.dataset.settingsClosed'), 'true', 'plain Escape still closes settings');
  await run('delete document.body.dataset.settingsClosed; document.querySelector(".danger-zone .settings-actions button").click()');
  await wait('!!document.querySelector(".confirm-dialog")');
  const button = await run(`(() => {
    const e = document.querySelector('.confirm-actions .primary'), r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, background: getComputedStyle(e).backgroundColor };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(button.x), y: Math.round(button.y) });
  await paint();
  const hover = await run('getComputedStyle(document.querySelector(".confirm-actions .primary")).backgroundColor');
  if (hover !== button.background) failures.push(`confirmation hover lost primary background: ${hover}`);
  await shot('settings-confirm-hover');
  await run('document.querySelector(".confirm-actions button:not(.primary)").click()');
  await wait('!document.querySelector(".confirm-dialog")');
  assert.deepEqual(failures, []);
  // Deferred fixture operations let us observe progress without touching real data.
  await run('document.querySelector(".danger-zone .settings-actions button").click()');
  await wait('!!document.querySelector("[data-local-confirm]:not(:disabled)")');
  await run('document.querySelector(".confirm-actions .primary").click()');
  await wait('document.querySelector(".danger-zone .settings-actions button").textContent === "正在清空…"');
  assert.equal(await run('document.querySelector(".local-reset button").disabled'), true);
  assert.equal(await run('document.querySelector("#cloud-clear-hint").textContent'), '有其他操作正在进行，请等待完成。');
  await run('document.dispatchEvent(new Event("fixture:finish-operation"))');
  await wait('!document.querySelector(".local-reset button").disabled');
  assert.equal(await run('document.querySelector(".danger-zone .settings-actions").contains(document.querySelector(".local-reset"))'), false);
  assert.equal(await run('document.querySelector(".cloud-data-controls button").disabled'), true);
  await run('document.querySelector(".cloud-data-controls input").scrollIntoView({block:"center"}); document.querySelector(".cloud-data-controls input").focus()');
  await win.webContents.insertText('DELETE');
  await wait('!document.querySelector(".cloud-data-controls button").disabled');
  await run('document.querySelector(".cloud-data-controls button").click()');
  await wait('document.querySelector(".cloud-data-controls button").textContent === "正在删除云端数据…"');
  assert.equal(await run('document.querySelector(".settings-toolbar button").disabled'), true);
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))');
  assert.notEqual(await run('document.body.dataset.settingsClosed'), 'true', 'destructive operation retains the exit lock');
  await run('document.dispatchEvent(new Event("fixture:finish-operation"))');
  await wait('!document.querySelector(".settings-toolbar button").disabled');
  assert.equal(await run('document.querySelector(".cloud-data-controls input").value'), '');
  await run('document.querySelector("[data-settings-section=sync]").click()');
  await run('document.querySelector(".sync-overview .primary").click()');
  await wait('document.querySelector(".sync-overview .primary").textContent === "正在同步…"');
  await run('document.dispatchEvent(new Event("fixture:finish-operation"))');
  await wait('!document.querySelector(".sync-overview .primary").disabled');
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [640, 1280]) {
    win.setContentSize(width, 900);
    await win.loadFile(join(output, 'index.html'), { query: { surface: 'settings', locale, diagnosticError: '1' } });
    await wait('!!document.querySelector(".sync-stage-list [data-stage-state=failed]")');
    await run('document.querySelector("[data-settings-section=sync]").click()');
    await paint();
    const geometry = await run(`(() => {
      const card = document.querySelector('.cloud-data-row'), heading = card.querySelector('h2').getBoundingClientRect();
      const description = card.querySelector('.settings-description p').getBoundingClientRect();
      return { gap: description.top - heading.bottom,
        texts: [...document.querySelectorAll('.sync-stage-list strong, .sync-stage-list small')].map(e => ({text:e.textContent, clipped:e.scrollWidth > e.clientWidth + 1})),
        rows: [...document.querySelectorAll('.sync-stage-list li')].map(li => [Math.round(li.getBoundingClientRect().top), Math.round(li.querySelector('strong').getBoundingClientRect().top)]),
        raw: /oauth_/.test(document.querySelector('.sync-overview').textContent), primary: document.querySelector('.sync-overview .primary').textContent,
        overflow: [...document.querySelectorAll('.settings-card, .settings-control')].filter(e=>e.getClientRects().length).some(e => e.scrollWidth > e.clientWidth + 2) };
    })()`);
    assert.ok(geometry.gap <= 12, `cloud heading gap: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.texts.some(t => t.clipped), false, JSON.stringify(geometry.texts));
    // Raw reason codes stay in the copied report; same-row stage titles share one baseline.
    assert.equal(geometry.raw, false);
    assert.equal(geometry.primary, { 'zh-CN': '重新连接', 'zh-TW': '重新連線', en: 'Reconnect' }[locale]);
    for (const [row, title] of geometry.rows) for (const [other, otherTitle] of geometry.rows) if (row === other) assert.ok(Math.abs(title - otherTitle) <= 1, JSON.stringify(geometry.rows));
    if (locale === 'en') await shot(`settings-diagnostics-${width}`);
    await run('document.querySelector("[data-settings-section=data]").click()'); await paint();
    const gap = await run('(()=>{const card=document.querySelector(".cloud-data-row");return card.querySelector(".settings-description p").getBoundingClientRect().top-card.querySelector("h2").getBoundingClientRect().bottom})()');
    assert.ok(gap <= 12, 'visible cloud heading gap');
    await run('document.querySelector(".settings-grid").scrollTop = document.querySelector(".settings-grid").scrollHeight');
    if (locale === 'zh-CN') await shot(`settings-data-${width}`);
  }
  win.focus();
  win.webContents.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 0, y: 0 });
  await paint();
  console.log('Settings interactions passed: IME, nested confirmation, clearing/sync progress, cloud confirmation, localized diagnostic wrapping and data layout.');
};
