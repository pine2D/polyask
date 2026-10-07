const { app, BrowserWindow, session, nativeTheme, clipboard } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2];
const only = process.argv[3] || '';
let lastInput = null;
app.setPath('userData', join(output, 'profile'));
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, label) => { if (!value) throw Error(label); };
async function until(win, expression) {
  const deadline = Date.now() + 10_000;
  while (!await win.webContents.executeJavaScript(expression)) {
    check(Date.now() < deadline, 'native UI timeout: ' + expression);
    await pause(30);
  }
}
const button = text => `[...document.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`;
async function click(win, expression) {
  win.focus(); await until(win, 'document.hasFocus()');
  const box = await win.webContents.executeJavaScript(`(()=>{const n=${expression}; if(!n)return null;
    n.scrollIntoView({block:'center',inline:'nearest'}); const r=n.getBoundingClientRect();
    const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);window.technicalNativeClick=null;
    document.addEventListener('click',event=>{window.technicalNativeClick={trusted:event.isTrusted,hitInside:n===event.target||n.contains(event.target),defaultPrevented:event.defaultPrevented,documentFocus:document.hasFocus(),activationActive:navigator.userActivation?.isActive??null,x:event.clientX,y:event.clientY};},{once:true});
    return {x,y,width:r.width,height:r.height,visible:!!n.getClientRects().length&&!n.disabled,hitInside:!!hit&&(n===hit||n.contains(hit)),documentFocus:document.hasFocus()};})()`);
  check(box && box.visible && box.width >= 24 && box.height >= 24,
    'native click target ' + expression + ': ' + JSON.stringify(box));
  check(box.hitInside && box.documentFocus, 'native target is focused and unobstructed');
  const zoom = win.webContents.getZoomFactor(), point = { x: Math.round(box.x * zoom), y: Math.round(box.y * zoom) };
  lastInput = { expression, box, zoom, point, windowFocusBefore: win.isFocused(), webFocusBefore: win.webContents.isFocused() };
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  await pause(30);
  lastInput.actual = await win.webContents.executeJavaScript('window.technicalNativeClick');
  check(lastInput.actual?.trusted && lastInput.actual?.hitInside && lastInput.actual?.documentFocus, 'native click is trusted and reaches its focused target');
}
async function observeClipboard(win) {
  await win.webContents.executeJavaScript(`(()=>{
    const api=navigator.clipboard;window.technicalClipboard={available:!!api?.writeText,calls:0,settled:'none'};
    if(!api?.writeText)return;const nativeWrite=api.writeText.bind(api);
    const rejected=error=>{const probe=window.technicalClipboard,message=String(error?.message??'').slice(0,160);
      probe.settled='rejected';probe.errorName=String(error?.name??'Error').slice(0,32);
      probe.focusError=/focus/i.test(message);probe.permissionError=/denied|permission|not allowed/i.test(message);
      probe.focusAtSettle=document.hasFocus();};
    api.writeText=function(text){window.technicalClipboard={available:true,calls:window.technicalClipboard.calls+1,length:text.length,
      settled:'pending',documentFocus:document.hasFocus(),activationActive:navigator.userActivation?.isActive??null};
      try{return nativeWrite(text).then(()=>{window.technicalClipboard.settled='fulfilled';window.technicalClipboard.focusAtSettle=document.hasFocus();},error=>{rejected(error);throw error;});}
      catch(error){rejected(error);throw error;}};
  })()`);
}
async function value(win, text) {
  await win.webContents.executeJavaScript(`window.technicalReading.setValue(${JSON.stringify(text)})`);
  await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
}
async function run(win, locale, width) {
  const labels = await win.webContents.executeJavaScript('window.technicalReading.labels');
  await clipboard.writeText('before');
  await click(win, button(labels.copy));
  await until(win, `document.querySelector('.markdown-code [role="status"]').textContent===${JSON.stringify(labels.copied)}`);
  check(await clipboard.readText() === '\tconst x = "<script>";\n', 'system clipboard keeps tabs and trailing LF');
  const firstCopy = { input: lastInput, clipboard: await win.webContents.executeJavaScript('window.technicalClipboard') };
  check(await win.webContents.executeJavaScript("!document.querySelector('script:not([src]),pre code span')"), 'source is plain and inert initially');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await until(win, `document.activeElement?.textContent===${JSON.stringify(labels.highlight)}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await until(win, "document.querySelectorAll('pre code span').length>0");
  check(await win.webContents.executeJavaScript('document.querySelector("pre code").textContent===\'\\tconst x = "<script>";\''), 'highlight does not alter code');
  await click(win, button(labels.plain));
  await value(win, '$$\n\\frac{1}{2}\n$$');
  check(await win.webContents.executeJavaScript("!document.querySelector('math')"), 'formula begins as source');
  await click(win, button(labels.preview));
  await until(win, "document.querySelectorAll('math mfrac mn').length===2");
  check(await win.webContents.executeJavaScript("document.querySelector('math').namespaceURI==='http://www.w3.org/1998/Math/MathML' && !document.querySelector('math annotation')"), 'actual local Worker emits safe MathML');
  await click(win, button(labels.source));
  check(await win.webContents.executeJavaScript("document.querySelector('.markdown-math-source').textContent==='$$\\n\\\\frac{1}{2}\\n$$' && !document.querySelector('.markdown-math pre').hidden"), 'formula source remains available');
  await value(win, '$$\n\\begin{matrix}1&2\\\\3&4\\end{matrix}\n$$');
  await click(win, button(labels.preview));
  await until(win, "document.querySelectorAll('math mtable mn').length===4");
  await value(win, '$$\n\\frac{\n$$');
  await click(win, button(labels.preview));
  await until(win, `document.querySelector('.markdown-math [role="status"]').textContent===${JSON.stringify(labels.failed)}`);
  for (const [source, reason] of [['x+'.repeat(2050), labels.limit], ['\\href{https://evil.example}{x}', labels.unsupported], ['\\gdef\\again{\\again}\\again', labels.unsupported]]) {
    const literal = '$$\n' + source + '\n$$';
    await value(win, literal);
    check(await win.webContents.executeJavaScript(`document.querySelector('.markdown-math-source').textContent===${JSON.stringify(literal)} && document.querySelector('.markdown-math [role="status"]').textContent===${JSON.stringify(reason)} && !document.querySelector('math,a,img')`), 'unsafe or oversized formula stays source');
  }
  await value(win, '```future-language\nkeep **literal**\n```');
  await click(win, button(labels.copy));
  await until(win, `document.querySelector('.markdown-code [role="status"]').textContent===${JSON.stringify(labels.copied)}`);
  check(await clipboard.readText() === 'keep **literal**\n', 'unknown language is fully copyable');
  await value(win, 'Price $5 and $10. Escaped \\$x\\$. Inline `$x$`.');
  check(await win.webContents.executeJavaScript("!document.querySelector('.markdown-math') && document.querySelector('p').textContent==='Price $5 and $10. Escaped $x$. Inline $x$.'"), 'currency and literal code are not formulas');
  await value(win, '```js\nconst x = 1;\n```\n\n$$\n\\frac{1}{2}\n$$');
  await click(win, button(labels.highlight)); await click(win, button(labels.preview));
  await until(win, "document.querySelector('math mfrac')");
  check(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1'), 'reading does not widen the window');
  writeFileSync(join(output, `${locale}-${width}.png`), (await win.webContents.capturePage()).toPNG());
  if (locale === 'zh-TW' && width === 640) {
    win.webContents.setZoomFactor(1.5);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await pause(50);
    check(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth+1'), '150 percent forced-colors keeps the layout contained');
    writeFileSync(join(output, 'zh-TW-640-forced-150.png'), (await win.webContents.capturePage()).toPNG());
  }
  return { locale, width, ok: true, systemClipboardExact: true, workerMathml: true, firstCopy };
}
app.whenReady().then(async () => {
  let requests = 0;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => { requests++; callback({ cancel: true }); });
  const report = [];
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const width of [1200, 640]) {
    if (only && only !== `${locale}:${width}`) continue;
    lastInput = null;
    const win = new BrowserWindow({ width, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    try {
      await win.loadFile(join(output, 'index.html'), { query: { locale } }); win.webContents.setZoomFactor(1); win.focus();
      await until(win, 'window.technicalReading && document.querySelector(".markdown-code")');
      await until(win, 'document.hasFocus()');
      await observeClipboard(win);
      report.push(await run(win, locale, width));
    } catch (error) {
      const diagnostics = await win.webContents.executeJavaScript("({codeNotice:document.querySelector('.markdown-code [role=\"status\"]')?.textContent??'',copyDisabled:document.querySelector('.markdown-code-actions button')?.disabled??null,clipboard:window.technicalClipboard??null,documentFocus:document.hasFocus(),notice:document.querySelector('.markdown-math [role=\"status\"]')?.textContent??'',sourceLength:document.querySelector('.markdown-math-source')?.textContent?.length??0,innerWidth,scrollWidth:document.documentElement.scrollWidth})").catch(() => ({}));
      diagnostics.lastInput = lastInput; diagnostics.windowFocus = win.isFocused(); diagnostics.webFocus = win.webContents.isFocused();
      writeFileSync(join(output, `${locale}-${width}-failed.png`), (await win.webContents.capturePage()).toPNG());
      report.push({ locale, width, ok: false, error: String(error), diagnostics });
    }
    finally { win.destroy(); }
  }
  const scope = only ? `targeted:${only}` : 'full-six';
  writeFileSync(join(output, 'report.json'), JSON.stringify({ scope, report, requests }));
  console.log(JSON.stringify({ artifact: output, scope, report, requests }));
  app.exit(report.length === (only ? 1 : 6) && report.every(item => item.ok) && requests === 0 ? 0 : 1);
}).catch(error => { console.error(String(error)); app.exit(1); });
