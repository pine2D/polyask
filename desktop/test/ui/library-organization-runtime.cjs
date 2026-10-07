const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const output = process.argv[2];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  let win;
  app.on('window-all-closed', () => {});
  const run = expression => win.webContents.executeJavaScript(`(() => {
    const f=window.organizationFixture, q=selector=>document.querySelector(selector);
    return (${expression});
  })()`);
  const state = () => run(`({ ready:f?.ready, saves:f?.saves, creates:f?.creates, patches:f?.patches,
    active:document.activeElement?.outerHTML?.slice(0,180), tagLength:[...(q('[name=archive-tags]')?.value??'')].length,
    tagCounts:q('.archive-tag-counts')?.textContent, inputEvents:f?.inputEvents, keyEvents:f?.keyEvents })`);
  const check = async (condition, message) => {
    if (!await run(condition)) throw new Error(`${message}: ${JSON.stringify(await state())}`);
  };
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 5000;
    while (!await run(condition)) {
      if (Date.now() >= deadline) throw new Error(`${message}: ${JSON.stringify(await state())}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  const point = async selector => {
    const quoted = JSON.stringify(selector);
    await waitFor(`(() => {const node=q(${quoted});return !!node&&!node.disabled&&node.getBoundingClientRect().height>0;})()`, `control must be ready: ${selector}`);
    return run(`(() => {const node=q(${quoted});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  };
  const clickAt = location => {
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...location });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...location });
  };
  const click = async selector => clickAt(await point(selector));
  const key = async (keyCode, modifiers = []) => {
    const previous = await run('f.keyEvents.length');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await waitFor(`f.keyEvents.length>=${previous + 2}&&f.keyEvents.at(-1).type==='keyup'&&f.keyEvents.at(-1).trusted`, `native key must complete: ${keyCode}`);
  };
  const enter = async (selector, text) => {
    await click(selector);
    await waitFor(`document.activeElement===q(${JSON.stringify(selector)})`, `native input must focus ${selector}`);
    await key('A', [process.platform === 'darwin' ? 'meta' : 'control']); await key('Backspace');
    await waitFor(`q(${JSON.stringify(selector)}).value===''`, `native clearing must finish before text insertion: ${selector}`);
    await win.webContents.insertText(text);
    await waitFor(`q(${JSON.stringify(selector)}).value===${JSON.stringify(text)}`, `native text must reach ${selector}`);
    await check('f.inputEvents.at(-1)?.trusted===true', 'input must come from the native Chromium channel');
  };
  let failed = false;
  for (const locale of ['zh-CN', 'zh-TW', 'en']) {
    nativeTheme.themeSource = locale === 'en' ? 'dark' : 'light';
    for (const width of [1200, 640]) {
      try {
        win = new BrowserWindow({ width, height: 1000, show: true, webPreferences: { sandbox: true, contextIsolation: true } });
        win.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
        win.webContents.on('render-process-gone', (_event, details) => console.error(JSON.stringify({ renderer: details.reason })));
        await win.loadFile(join(output, 'index.html'), { query: { locale } });
        win.focus(); win.webContents.focus();
        await waitFor('f?.ready===true&&document.hasFocus()', 'fixture effects and window focus must be ready');
        await click('.archive-metadata summary');
        await waitFor('q(".archive-metadata").open', 'metadata fields must be expanded');
        await enter('[name="archive-tags"]', '😀'.repeat(33));
        await waitFor('q(".archive-tag-counts")?.textContent.includes("33 / 32")', 'the oversized tag must render before submission');
        await enter('[name="archive-note"]', 'Carefully written notes 😀');
        await click('button[type="submit"]');
        await waitFor('f.saves>0||q("[name=archive-tags]").getAttribute("aria-invalid")==="true"', 'tag submission must show its validation result');
        await check('f.saves===0&&q("[name=archive-tags]").getAttribute("aria-invalid")==="true"', 'oversized tags must be corrected before saving');
        await waitFor('document.activeElement===q("[name=archive-tags]")', 'tag validation must focus its field');
        await enter('[name="archive-tags"]', Array(21).fill('same').join(', '));
        await waitFor('q(".archive-tags-field").textContent.includes("21 / 20")', 'the excess raw tag count must render');
        await check('q("[name=archive-tags]").getAttribute("aria-invalid")==="true"', 'duplicate raw tags still obey the 20-tag bound');
        await enter('[name="archive-tags"]', '😀'.repeat(32) + '， research');
        await waitFor('q("[name=archive-tags]").getAttribute("aria-invalid")!=="true"', 'tag correction must clear the field error');
        await click('button[type="submit"]');
        await waitFor('q(".archive-metadata [role=status]").textContent.includes(f.copy.archiveMetadataSaveFailed)', 'metadata failure must render');
        await check(`q('[name="archive-tags"]').value===${JSON.stringify('😀'.repeat(32) + '， research')}
          &&q('[name="archive-note"]').value==='Carefully written notes 😀'`, 'failed metadata save retains tags and notes');
        await click('button[type="submit"]');
        await waitFor('f.saves===2&&!q(".archive-metadata small")&&q(".archive-metadata form").getAttribute("aria-busy")==="false"', 'successful metadata save must finish');
        await click('#organize');
        await waitFor('!!q(".folder-modal")', 'membership dialog must mount');
        await check('q(".folder-modal").textContent.includes(f.source.task)', 'organizing displays the complete object title');
        await waitFor('[...q(".folder-modal").querySelectorAll("button")].some(button=>button.textContent===f.copy.folderNew&&!button.disabled)', 'folder choices must load before creation');
        await click('.folder-modal > button[type="button"]');
        await waitFor('!!q("[name=folder-membership-name]")', 'the new-folder field must render');
        await enter('[name="folder-membership-name"]', '😀'.repeat(81));
        await waitFor('q(".folder-create-form").textContent.includes("81 / 80")', 'folder name codepoint count must render');
        await click('[data-action="create-folder"]');
        await waitFor('f.creates>0||q("[name=folder-membership-name]").getAttribute("aria-invalid")==="true"', 'folder-name submission must show its validation result');
        await check('f.creates===0&&q("[name=folder-membership-name]").getAttribute("aria-invalid")==="true"', 'invalid folder names stay in their field');
        await enter('[name="folder-membership-name"]', 'Research 😀');
        await click('[data-action="create-folder"]');
        await waitFor('f.creates===1&&q(".folder-modal [role=status]").textContent.includes(f.copy.folderFailed)', 'failed folder creation must render and allow retry');
        await check('q("[name=folder-membership-name]").value==="Research 😀"', 'failed creation retains the name');
        const createPoint = await point('[data-action="create-folder"]');
        clickAt(createPoint); clickAt(createPoint);
        await waitFor('!!q(".folder-checkboxes input")?.checked', 'created-folder selection must render');
        await check('f.creates===2&&f.patches===0', 'creation is serialized and does not auto-save associations');
        await waitFor('document.activeElement===q(".folder-checkboxes input")', 'created-folder focus returns to the choice list');
        await check('q(".folder-modal").scrollWidth<=q(".folder-modal").clientWidth+1', 'long context and field descriptions fit the modal width');
        await click('[data-action="save-memberships"]');
        await waitFor('f.patches===1&&q(".folder-modal [role=status]").textContent.includes(f.copy.folderFailed)', 'failed association save must render and allow retry');
        await check('q(".folder-checkboxes input").checked', 'failed association save retains selection');
        await click('[data-action="save-memberships"]');
        await waitFor('!q(".folder-modal")', 'successful association confirmation must close the dialog');
        await check('f.patches===2&&f.inputEvents.every(event=>event.trusted)', 'final confirmation can recover with native input throughout');
        console.log(JSON.stringify({ locale, width, ok: true, nativeInput: true }));
      } catch (error) { failed = true; console.log(JSON.stringify({ locale, width, ok: false, error: String(error) })); }
      finally { win?.destroy(); }
    }
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
