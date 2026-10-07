const { app, BrowserWindow, session, nativeTheme } = require('electron');
const { join } = require('node:path');
const { writeFileSync } = require('node:fs');
const output = process.argv[2], artifacts = process.argv[3];
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  const run = code => win.webContents.executeJavaScript(code);
  const pause = () => run('new Promise(resolve => setTimeout(resolve, 40))');
  const check = async (condition, message) => {
    if (!await run(condition)) throw new Error(`${message}: ${JSON.stringify(await run('({ active:document.activeElement?.outerHTML?.slice(0,160), summary:document.querySelector(".backup-footer strong")?.textContent, alert:document.querySelector("[role=alert]")?.textContent })'))}`);
  };
  const click = async selector => {
    const point = await run(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node) throw new Error('Missing control'); node.scrollIntoView({block:'nearest'}); const r=node.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}; })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await pause();
  };
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await pause();
  };
  const countIs = count => `document.querySelector('.backup-footer strong').textContent===window.reviewFixture.copy.backupSummary.replace('{count}',${count}).replace('{skipped}',window.reviewFixture.preview.items.length-${count})`;
  let failed = false;
  for (const count of [20, 100]) for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const theme of ['light', 'dark']) {
    const width = theme === 'light' ? 1440 : 640, name = `${count}-${locale}-${theme}-${width}`;
    try {
      nativeTheme.themeSource = theme;
      win.setContentSize(width, 800);
      await win.loadFile(join(output, 'index.html'), { query: { count: String(count), locale, theme } });
      await run('window.reviewReady'); await click('#opener');
      await check(`document.characterSet==='UTF-8' && !document.body.textContent.includes('Ã') && !document.body.textContent.includes('å')`, 'three-language fixture text is decoded as UTF-8');
      await check(`matchMedia('(prefers-color-scheme: dark)').matches===${theme === 'dark'}`, 'requested native color scheme is active');
      await check(countIs(0), 'unresolved new association is excluded from actual counts');
      const geometry = await run(`(() => { const panel=document.querySelector('.backup-workspace').getBoundingClientRect(), body=document.querySelector('.backup-body').getBoundingClientRect(), footer=document.querySelector('.backup-footer').getBoundingClientRect(); return { panel:{x:panel.x,y:panel.y,width:panel.width,height:panel.height},bodyHeight:body.height,footerBottom:footer.bottom,viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth }; })()`);
      if (geometry.overflow || geometry.bodyHeight < 150 || geometry.footerBottom > geometry.viewport[1]) throw new Error(`unusable geometry ${JSON.stringify(geometry)}`);
      await check(`!document.querySelector('.backup-versions').textContent.includes('Unchanged question') && !!document.querySelector('[data-changed=true]')`, 'default comparison shows changed business fields');
      await click('.backup-full-versions summary');
      await check(`document.querySelector('.backup-full-versions').open && document.querySelector('.backup-full-versions').textContent.includes('Unchanged question')`, 'complete version retains unchanged fields');
      await click('.backup-raw-data summary');
      await check(`document.querySelector('.backup-raw-data').open && document.querySelector('.backup-raw-data pre').textContent.includes('1767225600000')`, 'raw business scalar values remain available');
      await click('.backup-raw-data summary'); await click('.backup-full-versions summary');
      await click('[data-backup-key="decision:d1"]');
      await check(`document.querySelector('.backup-dependencies').textContent.includes(window.reviewFixture.copy.backupSourceOptional)`, 'decision source is optional and saved evidence is explained');
      await click('.backup-segments button:last-child');
      await check(countIs(1), 'explicit hidden decision choice contributes one import');
      await run(`document.querySelector('.backup-filters select').focus()`); await key('Down'); await key('Return');
      await check(`document.querySelector('.backup-filters select').value==='archive'`, 'native select filters item type');
      await click('.backup-filters nav button:nth-child(2)');
      await check(`document.querySelectorAll('.backup-list button').length===${count / 2}`, 'independent conflict filter narrows the visible archive set');
      await click('.backup-bulk button:first-child');
      await check(countIs(count / 2 + 1), 'visible conflict batch preserves hidden choices and excludes tombstones');
      await check(`window.reviewFixture.applied===null`, 'batch choices never write data');
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      writeFileSync(join(artifacts, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      writeFileSync(join(artifacts, `${name}.json`), JSON.stringify(geometry, null, 2));
      await click('.backup-bulk button:last-child');
      await check(countIs(1), 'visible clear preserves the hidden decision choice');
      await run(`const select=document.querySelector('.backup-filters select'); select.value='all'; select.dispatchEvent(new Event('change',{bubbles:true}));`); await pause();
      await click('.backup-filters nav button:nth-child(3)');
      await click('[data-backup-key="folderMembership:link"]');
      await check(`document.querySelector('.backup-add-dependencies').textContent.includes('1')`, 'safe dependency selection has an explicit count');
      await click('.backup-add-dependencies');
      await check(countIs(2), 'safe dependency action leaves deleted folder and association excluded');
      await click('[data-dependency-key="folder:deleted"]');
      await check(`document.querySelector('.backup-comparison h3').textContent==='Deleted folder' && document.activeElement===document.querySelector('.backup-comparison h3') && document.querySelector('.backup-filters select').value==='all'`, 'named dependency locates the item across filters and focuses its heading');
      await check(`!document.querySelector('.backup-choice input').checked`, 'deleted folder still requires an individual choice');
      await click('.backup-choice input'); await check(countIs(4), 'manual deleted restoration resolves association prerequisites');
      await click('.backup-footer button');
      await check(`window.reviewFixture.applied===null && document.querySelectorAll('.backup-summary li').length===4`, 'final summary is a separate four-item confirmation');
      await click('.backup-footer button');
      await check(`JSON.stringify(window.reviewFixture.applied.slice().sort())===JSON.stringify(['decision:d1','archive:a0','folder:deleted','folderMembership:link'].sort()) && !document.querySelector('[role=dialog]') && document.activeElement.id==='opener'`, 'only explicit choices reach final restore and focus returns');
      console.log(JSON.stringify({ count, locale, theme, width, ok: true }));
    } catch (error) { failed = true; console.log(JSON.stringify({ count, locale, theme, width, ok: false, error: String(error) })); }
  }
  app.exit(failed ? 1 : 0);
}).catch(error => { console.error(error); app.exit(1); });
