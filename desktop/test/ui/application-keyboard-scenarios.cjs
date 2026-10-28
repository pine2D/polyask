const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ win, manager, pages, keys, dispatch, run, key, click, pause, until,
  output, locale, services, ipcMain, sync, boundary }) => {
  const report = [], site = pages[1].view.webContents;
  win.webContents.setZoomFactor(1); win.setSize(1600, 1000); await pause(150);
  ipcMain.handle('polyask:global-prompt-shortcut-state', () => ({ accelerator:null, activeAccelerator:null, status:'disabled' }));
  ipcMain.handle('polyask:notification-status', () => ({ state:'idle', revision:0 }));
  ipcMain.handle('polyask:site-health', () => []);
  ipcMain.handle('polyask:sync-diagnostics', () => services.createSyncDiagnosticSnapshot(sync, { version:'native-check', distribution:'installed' }));
  ipcMain.handle('polyask:backup-cancel', () => {});
  ipcMain.handle('polyask:local-data-stats', () => ({ history:0, archives:0, decisions:0, folders:0, answers:0, memberships:0,
    drafts:0, reset:{ preferences:0, answers:0, memberships:0, templates:0, groups:0, workspace:0 } }));
  for (const name of ['folder-list', 'archive-tags']) ipcMain.handle('polyask:' + name, () => []);
  ipcMain.handle('polyask:folder-query', () => ({ total:0, page:0, selected:null, selectedPage:null, selectedTargets:[], items:[] }));
  const expanded = () => run('document.querySelector("[data-composer-toggle]")?.getAttribute("aria-expanded")==="true"');
  const reset = async () => {
    manager.setPage(0);
    dispatch('focus-current-site');
    await until(() => run('!!document.querySelector(".app-shell")'), 'keyboard reset surface');
    if (await expanded()) { dispatch('focus-prompt'); await until(async () => !(await expanded()), 'collapse prompt'); }
    await pause(250); win.focus(); site.focus();
  };
  await site.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body tabindex="-1"><p>Local typing fixture</p><input id="composer"></body>'));
  await site.executeJavaScript(`window.pageKeys=[];addEventListener('keydown',e=>{
    pageKeys.push(e.key);const input=document.querySelector('input');
    if(document.activeElement!==input&&e.key.length===1&&!e.ctrlKey&&!e.metaKey){e.preventDefault();input.focus();input.value+=e.key;}
  },true)`);
  for (const inInput of [false, true]) {
    await reset();
    await site.executeJavaScript(`pageKeys=[];document.querySelector('input').value='';${inInput ? "document.querySelector('input').focus()" : 'document.body.focus()'}`);
    await key(site, 'Q', ['alt']); await until(expanded, 'Alt+Q opens from site');
    assert.equal(win.webContents.isFocused(), true);
    assert.equal(await site.executeJavaScript('document.querySelector("input").value'), '');
    assert.equal(await site.executeJavaScript('pageKeys.length'), 0, 'reserved Alt+Q never reaches printable page handler');
    // Expansion alone controls the toggle, even after the user returns to the AI page.
    if (!inInput) site.focus();
    await key(inInput ? win.webContents : site, 'Q', ['alt']);
    await until(async () => !(await expanded()) && site.isFocused(), 'Alt+Q closes independent of focus');
    report.push({ name:'Alt+Q deterministic toggle', inInput });
  }
  await reset(); await key(site, 'Q', ['alt']); await until(expanded, 'prepare image tray');
  await run(`(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'local.png',{type:'image/png'}));document.querySelector('[name=prompt]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}))})()`);
  await until(() => run('!!document.querySelector(".image-count")'), 'local image selected');
  await click('.image-trigger'); await until(() => run('!!document.querySelector(".image-tray[data-state=open]")'), 'image tray opens');
  await click('.image-tray-close'); await until(() => run('!document.querySelector(".image-tray")'), 'image tray exits');
  site.focus(); await key(site, ',', ['control']);
  await until(async () => await run('!!document.querySelector(".settings-workspace")') && win.webContents.isFocused(), 'settings after image tray');
  await key(win.webContents, 'Escape');
  await until(() => run('!document.querySelector(".settings-workspace")'), 'settings exits after image tray');
  await until(() => site.isFocused(), 'closed image tray does not retain the next panel focus source');
  report.push({ name:'image tray does not leak focus session' });
  await reset(); await key(site, 'Q', ['alt']); await until(expanded, 'expanded before history');
  dispatch('open-question-history');
  await until(() => run('!!document.querySelector(".question-history[data-state=open]")'), 'history over expanded prompt');
  await key(win.webContents, 'Q', ['alt']);
  await until(async () => !(await expanded()) && site.isFocused(), 'Alt+Q closes expanded prompt with history open');
  report.push({ name:'Alt+Q closes expanded prompt with history open' });
  for (const [command, selector, shortcut] of [
    ['open-settings', '.settings-workspace', [',', ['control']]],
    ['open-sites', '.workspace-drawer[data-state="open"]', ['S', ['alt']]],
    ['open-site-health', '.workspace-drawer[data-state="open"]', ['H', ['alt']]],
    ['open-question-history', '.question-history[data-state="open"]'],
    ['open-archive', '.folder-workspace'],
    ['open-command-palette', '.command-palette', ['P', ['control','shift']]],
    ['open-shortcuts', '.command-palette']
  ]) {
    await reset();
    if (shortcut) await key(site, ...shortcut); else dispatch(command);
    await until(() => run(`!!document.querySelector(${JSON.stringify(selector)})`), command);
    await until(() => win.webContents.isFocused(), command + ' native focus');
    assert.equal(await run('document.hasFocus() && document.activeElement !== document.body'), true, command + ' initial DOM focus');
    await key(win.webContents, 'Escape');
    await until(() => run(`!document.querySelector(${JSON.stringify(selector)})`), command + ' immediate Escape');
    await until(() => site.isFocused(), command + ' returns original site');
    report.push({ name:'open/Escape/return', command });
    boundary();
  }
  await reset(); win.webContents.focus();
  await click('.question-trigger'); await until(() => run('!!document.querySelector(".question-history[data-state=open]")'), 'pointer history');
  await key(win.webContents, 'Escape');
  await until(() => run('document.activeElement?.matches(".question-trigger")'), 'return shell opener');
  assert.equal(win.webContents.isFocused(), true);
  report.push({ name:'pointer opener return' });
  manager.setSelection(keys.slice(0, 5)); await pause(150);
  dispatch('open-shortcuts'); await until(() => run('!!document.querySelector("#command-results")'), 'reference');
  await pause(150);
  const shortcuts = await run(`Array.from(document.querySelectorAll('#command-results [role=option]')).map(e=>({
    key:e.querySelector('kbd')?.textContent,group:e.querySelector('small')?.textContent,disabled:e.getAttribute('aria-disabled')}))`);
  const first = shortcuts.findIndex(item => item.key === 'Alt+1');
  assert.equal(shortcuts.slice(first, first + 3).map(item => item.key).join(','), 'Alt+1,Alt+2,Alt+3');
  assert.equal(shortcuts[first + 2].disabled, 'true');
  assert.equal(shortcuts.some(item => item.key === 'Alt+W'), false);
  assert.equal(shortcuts.find(item => item.key === 'Ctrl+A')?.group, services.getCopy(locale).commandGroupEdit);
  fs.writeFileSync(join(output, 'shortcuts-' + locale + '.png'), (await win.webContents.capturePage()).toPNG());
  report.push({ name:'stable reference', shortcuts });
  await key(win.webContents, 'Escape'); await reset(); manager.setSelection(keys);
  fs.writeFileSync(join(output, 'keyboard-' + locale + '.json'), JSON.stringify(report, null, 2));
};
