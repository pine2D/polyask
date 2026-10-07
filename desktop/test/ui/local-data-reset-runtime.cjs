const { app, BrowserWindow, session } = require("electron");
const { join } = require("node:path");
const output = process.argv[2];
app.setPath("userData", join(output, "profile"));
const read = (window, expression) => window.webContents.executeJavaScript(expression);
async function wait(window, expression, label) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await read(window, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error(`timeout: ${label}`);
}
function check(value, message) { if (!value) throw Error(message); }
async function click(window, expression) {
  await wait(window, `!!(${expression}) && !(${expression}).disabled`, "enabled target");
  await read(window, `(${expression}).scrollIntoView({block:'center',inline:'nearest'})`);
  const point = await read(window, `(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
  check(point.width >= 24 && point.height >= 24, "reset native target must be visible and at least 24px");
  window.focus(); await wait(window, "document.hasFocus()", "native window focus");
  for (const type of ["mouseDown", "mouseUp"]) window.webContents.sendInputEvent({ type, button: "left", clickCount: 1,
    x: Math.round(point.x), y: Math.round(point.y) });
}
async function key(window, keyCode, modifiers = []) {
  await read(window, "window.resetKeyUpTrusted=false");
  for (const type of ["keyDown", "keyUp"]) window.webContents.sendInputEvent({ type, keyCode, modifiers });
  await wait(window, "window.resetKeyUpTrusted===true", "trusted keyup");
}
async function resetFlow(window) {
  await wait(window, '!!document.querySelector("textarea[name=prompt]")', "shell bootstrap");
  await click(window, 'document.querySelector("textarea[name=prompt]")');
  await wait(window, 'document.activeElement===document.querySelector("textarea[name=prompt]")', "prompt focus");
  await window.webContents.insertText("Old question");
  await wait(window, 'document.querySelector("textarea[name=prompt]").value==="Old question"&&window.resetInputTrusted===true', "native question input");
  await read(window, "window.localDataResetFixture.seedImage()");
  await wait(window, 'document.querySelector(".image-trigger")?.dataset.imageCount==="1"', "synthetic selected image setup");
  await key(window, "Enter", [process.platform === "darwin" ? "meta" : "control"]);
  await wait(window, 'window.localDataResetFixture.result().sends===1&&!!document.querySelector(".uncertain-retry-trigger")', "old uncertain run");
  await read(window, 'window.localDataResetFixture.command("open-data-settings")');
  await wait(window, 'document.querySelector(".settings-advanced")?.open&&document.activeElement?.id==="settings-advanced-toggle"', "explicit data navigation");
  await click(window, '[...document.querySelectorAll("button")].find(el=>el.textContent===window.localDataResetFixture.copy.resetLocalAction)');
  await wait(window, '!!document.querySelector("[data-local-confirm]")&&!document.querySelector("[data-local-confirm]").disabled', "valid reset counts");
  check(await read(window, 'document.querySelectorAll(".local-data-counts li").length===9'), "reset shows all business and retained-setting scopes");
  await click(window, 'document.querySelector("[data-local-confirm]")');
  await wait(window, 'window.localDataResetFixture.result().resetPending&&document.querySelector(".settings-workspace .panel-close")?.disabled', "deferred reset closes the root navigation gate");
  check(await read(window, 'window.localDataResetFixture.result().resets===1&&!window.localDataResetFixture.result().boundaryNavigation'), "IPC-start commands cannot navigate before the busy render");
  const surfaceCount = await read(window, "window.localDataResetFixture.result().surfaces.length");
  const blockedCommands = ["open-archive", "open-command-palette", "open-question-history", "focus-prompt"];
  for (const command of blockedCommands) {
    await read(window, `window.localDataResetFixture.command(${JSON.stringify(command)})`);
    await read(window, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    check(await read(window, '!!document.querySelector(".settings-workspace")&&document.querySelector(".settings-workspace .panel-close").disabled&&document.querySelector("[data-local-confirm]").disabled'), `pending reset blocks ${command} and keeps progress visible`);
    check(await read(window, `window.localDataResetFixture.result().surfaces.length===${surfaceCount}&&window.localDataResetFixture.result().resets===1&&window.localDataResetFixture.result().resetPending`), `pending ${command} cannot leave settings or duplicate the write`);
    check(await read(window, '!document.querySelector(".command-palette,.archive-workspace,.question-history")'), `pending ${command} cannot open another root surface`);
  }
  await read(window, "window.localDataResetFixture.finishReset()");
  await wait(window, 'window.localDataResetFixture.result().resets===1&&!document.querySelector(".confirm-dialog")&&!document.querySelector(".settings-workspace .panel-close").disabled', "explicit reset complete releases the root gate");
  await click(window, 'document.querySelector(".settings-workspace .panel-close")');
  await wait(window, '!document.querySelector(".settings-workspace")', "settings closed");
  check(await read(window, 'document.querySelector("textarea[name=prompt]").value===""'), "reset clears old text");
  check(await read(window, 'document.querySelector(".image-trigger")?.dataset.imageCount==="0"'), "reset clears old images");
  check(await read(window, '!document.querySelector(".retry-trigger,.uncertain-retry-trigger")'), "reset clears safe and uncertain retry affordances");
  await read(window, 'window.localDataResetFixture.command("retry-failed")');
  await read(window, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  check(await read(window, 'window.localDataResetFixture.result().sends===1&&!document.querySelector(".broadcast-retry-review")'), "reset makes the old retry unavailable");
  await read(window, 'window.localDataResetFixture.command("open-command-palette")');
  await wait(window, '!!document.querySelector(".command-palette")&&document.querySelector(".command-palette").contains(document.activeElement)&&!document.querySelector(".settings-workspace")', "settled reset restores root command navigation");
  await key(window, "Escape");
  await wait(window, '!document.querySelector(".command-palette")', "restored palette closes with native Escape");
  const result = await read(window, "window.localDataResetFixture.result()");
  check(result.pageError === "", "reset shell has no uncaught page error");
  return { ok: true, sends: result.sends, resets: result.resets, nativeInput: true, syntheticImageSetup: true,
    ipcStartCommandsBlocked: !result.boundaryNavigation, blockedCommands, navigationRestored: true };
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({ width: 1400, height: 900, show: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let failed = false;
  for (const file of ["index.html", "flow.html"]) {
    await window.loadFile(join(output, file));
    const result = file === "index.html" ? await resetFlow(window) : await read(window, "window.resetResult");
    console.log(JSON.stringify({ file, ...result }));
    if (!result.ok) failed = true;
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
