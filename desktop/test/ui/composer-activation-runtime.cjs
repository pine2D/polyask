const {app,BrowserWindow,ipcMain,session,nativeTheme}=require('electron');
const {join}=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const output=process.argv[2];app.setPath('userData',join(output,'profile'));
const keys=['claude','chatgpt','gemini','deepseek','doubao'];
const sites=keys.map(key=>({key,label:key,host:key+'.test',url:'https://'+key+'.test/',image:true,intl:true,authHosts:[]}));
app.whenReady().then(async()=>{
  let blocked=0;
  for(const s of [session.defaultSession,session.fromPartition('persist:polyask-sites')])s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{blocked++;cb({cancel:true})});
  const win=new BrowserWindow({show:true,width:1600,height:1000,webPreferences:{preload:join(output,'preload.cjs'),sandbox:true,contextIsolation:true}});
  win.setMenuBarVisibility(false);
  const {ViewManager}=require(join(output,'manager.cjs'));
  const manager=new ViewManager(win,()=>{},layout=>win.webContents.send('polyask:layout',layout),()=>{},{selectedSites:keys});
  const views=win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents);
  const startupEnd=Date.now()+5000;
  while(blocked<keys.length||views.some(v=>v.webContents.isLoadingMainFrame())){if(Date.now()>startupEnd)throw Error('Blocked startup loads did not settle');await new Promise(r=>setTimeout(r,20))}
  for(const v of views)await v.webContents.loadURL('data:text/html,<body style="background:%23f4f5f8"><input placeholder="local page"></body>');
  const workspace=()=>({selectedSites:keys,groups:[],tier:null});
  const sync={state:'idle',connected:false,pending:0,errorCount:0,readOnly:false,oauthConfigured:false,secureTokenStorage:true};
  const question={schema:4,id:'local-question',updatedAt:1,createdAt:1,deviceId:'fixture',text:'Saved local question',sites:['claude'],requestedTier:null,inputImageCount:0};
  const trusted=e=>e.sender===win.webContents;
  ipcMain.handle('polyask:bootstrap',()=>({runtime:{version:'native-check',distribution:'installed'},sites,statuses:keys.map(site=>({site,phase:'ready'})),layout:manager.getLayout(),workspace:workspace(),
    promptLibrary:{templates:[{id:'local-template',name:'Local template',text:'Local template draft',updatedAt:1,deviceId:'fixture'}],history:[]},pendingSynthesis:null,sync}));
  ipcMain.handle('polyask:set-display',(_e,v)=>{manager.setDisplayPreferences(v);return v});
  ipcMain.handle('polyask:site-history-state',()=>({}));ipcMain.handle('polyask:menu-shortcuts',()=>[]);
  ipcMain.handle('polyask:set-tier',()=>workspace());
  let pendingSend=null;
  ipcMain.handle('polyask:broadcast',(_e,request)=>new Promise(resolve=>{pendingSend={request,resolve}}));
  ipcMain.on('polyask:cancel',e=>{if(trusted(e)&&pendingSend){pendingSend.resolve(pendingSend.request.sites.map(site=>({site,ok:false,code:'cancelled'})));pendingSend=null}});
  ipcMain.handle('polyask:question-list',()=>({items:[{...question,savedSites:0,answers:[]}],cursor:null}));
  ipcMain.handle('polyask:question-run-progress',()=>null);
  ipcMain.handle('polyask:question-get',()=>({question,answers:[]}));
  ipcMain.handle('polyask:question-legacy',()=>({items:[],cursor:null}));
  ipcMain.handle('polyask:question-panel',(_e,v)=>manager.historyAccess.setPanelOpen(v));
  ipcMain.handle('polyask:preview-site-page-close',(_e,site)=>({site,contentsId:views[0].webContents.id,reason:null}));
  for(const [channel,action] of [['set-composer-expanded',v=>manager.setComposerExpanded(v)],['set-drawer-open',v=>manager.setDrawerOpen(v)],
    ['set-page',v=>manager.setPage(v)],['set-surface',v=>{manager.setSurface(v);if(v==='confirmation')win.webContents.focus()}],['set-layout',v=>manager.setLayout(v.mode,v.focused)]])
    ipcMain.on('polyask:'+channel,(e,v)=>{if(trusted(e))action(v)});
  const run=s=>win.webContents.executeJavaScript(s),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{const end=Date.now()+5000;while(!(await run(s))){if(Date.now()>end)throw Error('Timeout '+s);await pause(15)}};
  const paint=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const state=()=>run(`(()=>{const a=document.querySelector('[name=prompt]');return{expanded:document.querySelector('[data-composer-toggle]')?.getAttribute('aria-expanded'),
    focused:document.activeElement===a,hasFocus:document.hasFocus(),height:a?.parentElement.getBoundingClientRect().height,value:a?.value,start:a?.selectionStart,end:a?.selectionEnd,scroll:a?.scrollTop}})()`);
  const click=async selector=>{
    const p=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing click target');const r=e.getBoundingClientRect();return{x:r.x+Math.min(30,r.width/2),y:r.y+Math.min(12,r.height/2)}})()`);
    // 不预先 focus 外壳；否则会掩盖恢复焦点引起的误展开。
    const z=win.webContents.getZoomFactor();
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,x:Math.round(p.x*z),y:Math.round(p.y*z)});
    await paint();await pause(210);
  };
  const key=async(keyCode,modifiers=[])=>{for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode,modifiers});await paint();await pause(180)};
  const report={cases:[],fields:[]};
  const check=async(name,expanded)=>{const s=await state();report.cases.push({name,...s});fs.writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));assert.equal(s.expanded,String(expanded),name)};
  await win.loadFile(join(output,'index.html'));await wait('!!document.querySelector("[name=prompt]")&&document.querySelectorAll(".page-tabs button").length===2');
  win.focus();win.webContents.focus();await wait('document.hasFocus()');
  await run(`window.entryEvents=[];for(const type of ['focusin','focusout','keydown','keyup'])document.addEventListener(type,e=>{const t=e.target;window.entryEvents.push({type,key:e.key,shift:e.shiftKey,prevented:e.defaultPrevented,target:t?.getAttribute?.('name')||t?.className||t?.tagName,hasFocus:document.hasFocus()})},true)`);
  await click('[name=prompt]');await check('pointer entry',true);
  await win.webContents.insertText('Long draft / 长草稿\n'.repeat(40));
  await run('window.originalArea=document.querySelector("[name=prompt]");originalArea.setSelectionRange(17,43,"backward");originalArea.scrollTop=110');
  const before=await state();await key('Escape');await check('Escape collapses without blur',false);
  assert.equal((await state()).focused,true);
  await click('.page-tabs [data-page="1"]');await check('page 4–5 preserves collapse',false);
  await run('originalArea.focus()');await check('page focus restoration preserves collapse',false);
  assert.equal((await state()).start,before.start);assert.equal((await state()).end,before.end);
  assert.equal((await state()).scroll,before.scroll);
  await click('[name=prompt]');await check('reclick already focused editor',true);
  await key('Escape');win.webContents.send('polyask:command','focus-prompt');await pause(250);await check('focus command already focused editor',true);
  const focusStyle=()=>run('getComputedStyle(document.querySelector(".prompt-composer")).boxShadow');
  const pointerShadow=await focusStyle();await key('C',['control']);assert.equal(await focusStyle(),pointerShadow,'copy does not change focus style');
  fs.writeFileSync(join(output,'composer-focus.png'),(await win.webContents.capturePage()).toPNG());
  await key('Escape');
  const other=new BrowserWindow({show:true,width:300,height:200,webPreferences:{sandbox:true,contextIsolation:true}});
  await other.loadURL('data:text/html,local focus target');other.focus();other.webContents.focus();await pause(100);
  win.focus();await pause(200);await check('native window return preserves collapse',false);other.destroy();
  // Xvfb 返回窗口可能恢复到网页视图；另明确验证原生外壳焦点恢复。
  win.focus();win.webContents.focus();await wait('document.hasFocus()');await check('native shell focus restoration preserves collapse',false);
  await run('originalArea.blur();originalArea.focus()');await check('programmatic focus preserves collapse',false);
  // 临时窗口销毁后 Xvfb 的焦点交接可能迟到；Tab 专项从实际聚焦的外壳开始。
  win.focus();win.webContents.focus();await wait('document.hasFocus()');
  await key('Tab');await key('Tab',['shift']);report.tabEvents=await run('window.entryEvents.slice(-16)');await check('native Tab entry reopens editing',true);
  assert.equal(await focusStyle(),pointerShadow,'Tab and pointer share the focus language');
  await key('Escape');await click('.mode-switch button:nth-child(2)');await check('layout action preserves collapse',false);
  await click('.scope-main');await wait('!!document.querySelector("[data-close-site=claude]")');
  await click('[data-close-site=claude]');await wait('!!document.querySelector(".folder-modal")');await key('Escape');
  await check('cancel page close preserves collapse',false);
  assert.equal(await run('document.activeElement===document.querySelector(".scope-main")'),true,'cancel returns to a stable workbench control');
  await click('[name=prompt]');
  await run(`(()=>{const t=new DataTransfer();t.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'local.png',{type:'image/png'}));originalArea.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:t}))})()`);
  await wait('!!document.querySelector(".image-count")');await click('.image-trigger');await click('[name=prompt]');await key('Escape');
  await check('first Escape only collapses editor',false);assert.equal(await run('document.querySelector(".image-trigger").getAttribute("aria-expanded")'),'true');
  await key('Escape');assert.equal(await run('document.querySelector(".image-trigger").getAttribute("aria-expanded")'),'false');
  await click('.image-trigger');await click('.image-preview button');await click('[name=prompt]');await key('A',['control']);await key('Backspace');await key('Escape');
  assert.equal(await run('document.querySelector("[name=prompt]")===window.originalArea'),true,'ordinary actions retain the same textarea');
  win.webContents.send('polyask:command','open-command-palette');await wait('!!document.querySelector(".command-search input")');
  const fieldStyle=selector=>run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e);return{shadow:s.boxShadow,outline:s.outlineStyle,border:s.borderColor,background:s.backgroundColor}})()`);
  await pause(150);assert.equal((await fieldStyle('.command-search input')).shadow,pointerShadow);
  await click('#command-tab-library');await click('.prompt-library-item > button');await wait('!!document.querySelector("[name=prompt]")');await pause(250);
  await check('template insertion explicitly expands',true);assert.equal((await state()).value,'Local template draft');
  await key('A',['control']);await key('Backspace');await key('Escape');await click('.question-trigger');await wait('!!document.querySelector(".question-search input")');
  await pause(150);assert.equal((await fieldStyle('.question-search input')).shadow,pointerShadow,'question search shares composer focus');
  fs.writeFileSync(join(output,'question-search.png'),(await win.webContents.capturePage()).toPNG());
  await click('.question-main');await wait('!!document.querySelector("[data-action=reask-question]")');await click('[data-action=reask-question]');await pause(250);
  await check('history reask explicitly expands',true);assert.equal((await state()).value,question.text);
  await run('window.sendArea=document.querySelector("[name=prompt]")');
  for(const scenario of [
    {name:'keyboard send collapses after success',method:'keyboard',outcome:'success',expanded:false},
    {name:'button send collapses after partial success',method:'pointer',outcome:'partial',expanded:false},
    {name:'failed send retains draft and expansion',method:'pointer',outcome:'inject_failed',expanded:true},
    {name:'unconfirmed send retains draft and expansion',method:'keyboard',outcome:'submit_unconfirmed',expanded:true},
    {name:'cancelled send retains draft and expansion',method:'pointer',outcome:'cancelled',expanded:true},
    {name:'successful old send preserves next draft',method:'keyboard',outcome:'success',next:'Next local draft',expanded:true},
    {name:'successful old send preserves retyped identical draft',method:'keyboard',outcome:'success',next:'Local send draft',expanded:true}
  ]){
    await click('[name=prompt]');await key('A',['control']);await win.webContents.insertText('Local send draft');
    if(scenario.method==='keyboard')await key('Enter',['control']);else await click('.send');
    await wait('!!document.querySelector(".cancel")');assert.equal(pendingSend!==null,true,'send reaches the controlled IPC boundary');
    await check(scenario.name+' while pending',true);
    if(scenario.next){await click('[name=prompt]');await key('A',['control']);await key('Backspace');await win.webContents.insertText(scenario.next)}
    if(scenario.outcome==='cancelled')await click('.cancel');
    else{
      pendingSend.resolve(pendingSend.request.sites.map(site=>scenario.outcome==='success'||scenario.outcome==='partial'&&site==='claude'
        ?{site,ok:true}:{site,ok:false,code:scenario.outcome==='partial'?'not_ready':scenario.outcome}));pendingSend=null;
    }
    await wait('!!document.querySelector(".send")');await pause(190);await check(scenario.name,scenario.expanded);
    assert.equal((await state()).value,scenario.next||(scenario.expanded?'Local send draft':''));
    assert.equal(await run('document.querySelector("[name=prompt]")===window.sendArea'),true,'send keeps the same editor');
    if(!scenario.expanded){await run('sendArea.blur();sendArea.focus()');await check(scenario.name+' focus restoration',false)}
  }
  manager.setSurface('settings');
  await run(`(()=>{const panel=document.createElement('section');panel.id='field-gallery';panel.style='position:fixed;inset:60px 20px 40px;overflow:auto;z-index:100;background:var(--panel);padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px';
    const contexts=['archive-filters','library folder-filters','decision-filters','folder-modal','archive-fields','decision-editor','comparison-worksheet','synthesis-config','synthesis-preview','prompt-variable-editor','settings-card danger-zone','backup-workspace'];
    contexts.forEach((cls,i)=>{const row=document.createElement('div');row.className=cls;row.innerHTML='<label>'+cls+'</label><'+(i>3&&i<10?'textarea':'input')+' name="field-'+i+'" aria-label="'+cls+'" style="display:block;width:100%;min-height:36px;margin-top:8px" />';panel.append(row)});
    panel.insertAdjacentHTML('beforeend','<div><label>Error</label><input name="error" aria-invalid="true" value="Invalid name"></div><div><label>Read only</label><textarea name="readonly" readonly>Copyable text</textarea></div><div><label>Disabled</label><input name="disabled" disabled value="Disabled"><input name="checkbox" type="checkbox" disabled></div>');document.querySelector('#root').append(panel);
    const portal=document.createElement('div');portal.className='library-popover';portal.id='portal-search';portal.style='position:fixed;left:40px;bottom:50px;width:300px;z-index:101';portal.innerHTML='<input type="search" name="portal-search" aria-label="Portal search" placeholder="Menu search">';document.body.append(portal)})()`);
  for(const theme of ['light','dark']){
    nativeTheme.themeSource=theme;
    await run('document.querySelector("[name=prompt]").focus()');await pause(150);const reference=await focusStyle();
    for(const selector of [...Array.from({length:12},(_,i)=>'[name=field-'+i+']'),'[name=portal-search]']){
      await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);await pause(135);const s=await fieldStyle(selector);
      assert.equal(s.shadow,reference,theme+' '+selector+' consistent focus');assert.equal(s.outline,'none');assert.equal(s.border,'rgba(0, 0, 0, 0)');report.fields.push({theme,selector,...s});
    }
    await run('document.querySelector("[name=error]").focus()');await pause(135);const error=await fieldStyle('[name=error]');assert.notEqual(error.shadow,reference,'errors retain separate feedback');
    await run('document.querySelector("[name=readonly]").focus()');assert.equal(await run('document.activeElement.getAttribute("name")'),'readonly','read-only fields remain selectable');
    await run('document.querySelector("[name=disabled]").focus()');assert.equal(await run('document.activeElement.getAttribute("name")'),'readonly');
    assert.equal(await run('getComputedStyle(document.querySelector("[name=disabled]")).boxShadow'),'none');
    assert.equal(await run('getComputedStyle(document.querySelector("[name=checkbox]")).opacity'),'1','checkbox appearance is unchanged');
    fs.writeFileSync(join(output,theme+'-fields.png'),(await win.webContents.capturePage()).toPNG());
  }
  const debug=win.webContents.debugger;debug.attach('1.3');
  await debug.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]});
  for(const selector of ['[name=field-0]','[name=field-5]','[name=portal-search]']){
    await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);assert.equal((await fieldStyle(selector)).outline,'solid','system focus remains visible');
    assert.equal(await run(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transitionDuration`),'0s');
  }
  debug.detach();fs.writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`Native composer passed: ${report.cases.length} intent cases, ${report.fields.length} field/theme cases, actual production renderer, five real local views, forced colors and reduced motion.`);
  win.destroy();app.exit(0);
}).catch(e=>{console.error(e.stack);app.exit(1)});
