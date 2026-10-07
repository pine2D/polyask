const { app, BrowserWindow, session } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  const run = code => win.webContents.executeJavaScript(code);
  const check = async (condition, message) => {
    if (!await run(condition)) {
      const state = await run('({ active: document.activeElement?.outerHTML?.slice(0,200), choice: document.querySelector("output")?.textContent, keys: window.nativeKeys })');
      throw new Error(`${message}: ${JSON.stringify(state)}`);
    }
  };
  const key = async (keyCode, shift = false) => {
    const modifiers = shift ? ['shift'] : [];
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await run('new Promise(resolve => setTimeout(resolve, 40))');
  };
  let failed = false;
  for (const kind of ['folder', 'backup']) {
    try {
      await win.loadFile(join(output, 'index.html'), { query: { kind } });
      await run('window.modalReady');
      await run('document.querySelector("#opener").focus(); document.querySelector("#opener").click(); new Promise(resolve => setTimeout(resolve,40))');
      const first = kind === 'folder' ? '.folder-modal header button' : '.backup-header button';
      const last = kind === 'folder' ? '#note' : '.backup-footer button';
      await check(`document.activeElement === document.querySelector(${JSON.stringify(first)})`, `${kind}: initial cancel focus`);
      await key('Tab', true);
      await check(`document.activeElement === document.querySelector(${JSON.stringify(last)})`, `${kind}: Shift+Tab wraps to last visible control`);
      await key('Tab');
      await check(`document.activeElement === document.querySelector(${JSON.stringify(first)})`, `${kind}: Tab wraps to cancel`);
      if (kind === 'folder') {
        for (const id of ['name', 'summary', 'source', 'note']) {
          await key('Tab');
          await check(`document.activeElement.id === ${JSON.stringify(id)}`, `folder: native Tab reaches ${id} without hidden, disabled, inert or collapsed controls`);
        }
        await run('document.querySelector("#name").focus()');
      }
      for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
        await run(`window.lastIme = new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true, ...${JSON.stringify(composition)} }); document.activeElement.dispatchEvent(window.lastIme); new Promise(resolve=>setTimeout(resolve,40))`);
        await check('!window.lastIme.defaultPrevented && !!document.querySelector("[role=dialog]")', `${kind}: IME cancellation retains native default and surface`);
      }
      if (kind === 'folder') await check('document.querySelector("#name").value === "Keep this draft"', 'folder: IME cancellation preserves the draft');
      else {
        await run('document.querySelector(".backup-footer button").click(); new Promise(resolve=>setTimeout(resolve,40))');
        await key('Escape');
        await check('!!document.querySelector(".backup-body") && !document.querySelector(".backup-summary")', 'backup: first Escape leaves confirmation');
      }
      await key('Escape');
      await check('!document.querySelector("[role=dialog]") && document.activeElement.id === "opener"', `${kind}: ordinary Escape closes and restores opener`);
      console.log(JSON.stringify({ kind, ok: true }));
    } catch (error) { failed = true; console.log(JSON.stringify({ kind, ok: false, error: String(error) })); }
  }
  for (const kind of ['menu', 'select', 'images']) {
    try {
      await win.loadFile(join(output, 'index.html'), { query: { kind } });
      await run('window.modalReady');
      await run('document.querySelector("#opener").focus(); document.querySelector("#opener").click(); new Promise(resolve => setTimeout(resolve,40))');
      const trigger = kind === 'menu' ? '.library-menu-trigger' : kind === 'select' ? '.library-select' : '.image-trigger';
      const surface = kind === 'menu' ? '[role=menu]' : kind === 'select' ? '[role=listbox]' : '#image-tray';
      if (kind !== 'images') await run(`document.querySelector(${JSON.stringify(trigger)}).click(); new Promise(resolve => setTimeout(resolve,40))`);
      else await run('document.querySelector(".image-replace").focus()');
      for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
        await run(`window.lastIme = new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true, ...${JSON.stringify(composition)} }); document.activeElement.dispatchEvent(window.lastIme); new Promise(resolve=>setTimeout(resolve,40))`);
        await check(`!window.lastIme.defaultPrevented && !!document.querySelector(${JSON.stringify(surface)})`, `${kind}: IME Escape keeps native default and active surface`);
      }
      if (kind === 'select') {
        await run('window.nativeKeys = []; window.addEventListener("keydown", event => window.nativeKeys.push({key:event.key, keyCode:event.keyCode, isComposing:event.isComposing}), true)');
        await key('Down');
        for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
          await run(`window.lastIme = new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true, ...${JSON.stringify(composition)} }); document.activeElement.dispatchEvent(window.lastIme); new Promise(resolve=>setTimeout(resolve,40))`);
          await check('!window.lastIme.defaultPrevented && document.querySelector("output").textContent === "draft" && !!document.querySelector("[role=listbox]")', 'select: IME Enter does not choose highlighted option');
        }
        await key('Return');
        await check('document.querySelector("output").textContent === "final" && !document.querySelector("[role=listbox]")', 'select: ordinary native Enter chooses highlighted option');
      } else {
        await key('Escape');
        await check(`!document.querySelector(${JSON.stringify(surface)})`, `${kind}: ordinary native Escape closes surface`);
      }
      await check(`document.activeElement === document.querySelector(${JSON.stringify(trigger)})`, `${kind}: dismissal restores trigger`);
      console.log(JSON.stringify({ kind, ok: true }));
    } catch (error) { failed = true; console.log(JSON.stringify({ kind, ok: false, error: String(error) })); }
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
