const {app,BrowserWindow,ipcMain,nativeTheme,session}=require('electron');
const {join}=require('node:path'),{writeFileSync}=require('node:fs'),assert=require('node:assert/strict');
const output=process.argv[2];app.setPath('userData',join(output,'profile'));
app.whenReady().then(async()=>{
  let blocked=0;
  for(const s of [session.defaultSession,session.fromPartition('persist:polyask-sites')]) s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>{blocked++;cb({cancel:true})});
  const win=new BrowserWindow({show:true,width:1600,height:1000,webPreferences:{preload:join(output,'preload.cjs'),sandbox:true,contextIsolation:true}});
  win.setMenuBarVisibility(false);
  const run=s=>win.webContents.executeJavaScript(s),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async source=>{const end=Date.now()+5000;while(!(await run(source))){if(Date.now()>end)throw Error('Timeout '+source);await pause(15)}};
  const paint=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const {ViewManager}=require(join(output,'manager.cjs'));
  let events=0,delay=0;
  const nativeBounds=()=>win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents).map(v=>v.getBounds());
  const manager=new ViewManager(win,()=>{},layout=>{
    events++;
    win.webContents.send('motion:native',nativeBounds());
    win.webContents.send('polyask:layout',layout);
  },()=>{}, {selectedSites:['claude','chatgpt','deepseek','gemini']});
  const views=win.contentView.children.filter(v=>v.webContents&&v.webContents!==win.webContents);
  const startupEnd=Date.now()+5000;
  while(blocked<views.length||views.some(v=>v.webContents.isLoadingMainFrame())){if(Date.now()>startupEnd)throw Error('Blocked startup loads did not settle');await pause(20)}
  for(const v of views)await v.webContents.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:#f4f5f8;color:#626575;font:16px system-ui;padding:24px">本地网页视图 · 不联网<script>window.resizeCount=0;addEventListener("resize",()=>resizeCount++)</script>'));
  const trusted=e=>e.sender===win.webContents;
  ipcMain.on('polyask:set-composer-expanded',(e,v)=>{if(trusted(e))delay?setTimeout(()=>manager.setComposerExpanded(v),delay):manager.setComposerExpanded(v)});
  ipcMain.on('polyask:set-drawer-open',(e,v)=>{if(trusted(e))manager.setDrawerOpen(v)});
  ipcMain.on('polyask:set-surface',(e,v)=>{if(trusted(e))manager.setSurface(v)});
  ipcMain.on('polyask:set-layout',(e,v)=>{if(trusted(e))manager.setLayout(v.mode,v.focused)});
  ipcMain.handle('polyask:question-panel',(e,v)=>{if(trusted(e))manager.historyAccess.setPanelOpen(v)});
  const question={schema:4,id:'motion-local',updatedAt:1,createdAt:1,deviceId:'fixture',text:'本地动效测试 · 未发送',sites:['claude'],requestedTier:null,inputImageCount:0};
  ipcMain.handle('polyask:question-list',()=>({items:[{...question,savedSites:0,answers:[]}],cursor:null}));
  ipcMain.handle('polyask:question-get',()=>({question,answers:[]}));
  ipcMain.handle('polyask:question-legacy',()=>({items:[],cursor:null}));
  const click=async selector=>{
    const p=await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
    assert.equal(p.width>=24&&p.height>=24,true,'usable native pointer target');
    win.focus();win.webContents.focus();await wait('document.hasFocus()');
    const z=win.webContents.getZoomFactor();
    for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,button:'left',clickCount:1,x:Math.round(p.x*z),y:Math.round(p.y*z)});
    await paint();
  };
  const start=()=>run(`window.motionFrames=[];window.motionDone=false;requestAnimationFrame(function tick(t){const e=document.querySelector('.prompt-composer'),r=e.getBoundingClientRect(),b=document.querySelector('.command-bar').getBoundingClientRect();window.motionFrames.push({t,height:r.height,bottom:r.bottom,bar:b.height,native:(window.motionNative||[]).map(x=>x.y),reserved:b.height>80});if(window.motionFrames.length<25)requestAnimationFrame(tick);else window.motionDone=true})`);
  const trace=async selector=>{await start();await click(selector);await wait('window.motionDone');return run('window.motionFrames')};
  const resizeCounts=()=>Promise.all(views.map(v=>v.webContents.executeJavaScript('window.resizeCount')));
  const position=()=>run('(()=>{const e=document.querySelector("textarea");return{start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection,scroll:e.scrollTop,value:e.value}})()');
  const reports=[];
  for(const theme of ['light','dark'])for(const density of ['compact','comfortable'])for(const zoom of [1,1.5]){
    nativeTheme.themeSource=theme;delay=reports.length===0?90:0;
    await win.loadFile(join(output,'index.html'),{query:{locale:reports.length%2?'en':'zh-CN',density}});
    await wait('!!document.querySelector("textarea")');await paint();
    win.webContents.setZoomFactor(zoom);win.setContentSize(1600,1000);await paint();
    assert.equal(win.webContents.getZoomFactor(),zoom,'read back actual shell zoom after file navigation');
    manager.setDisplayPreferences({density,siteScale:1});manager.setLayout(reports.length%2?'focus':'overview');
    await wait('document.querySelectorAll(".tile-frame").length===4&&window.motionNative?.length===4');await pause(120);
    const low=density==='compact'?32:40,high=density==='compact'?112:136;
    const beforeEvents=events,beforeResize=await resizeCounts();
    const opening=await trace('textarea');
    writeFileSync(join(output,'opening-debug.json'),JSON.stringify({theme,density,zoom,opening,events:events-beforeEvents,
      css:await run('(()=>{const p=document.querySelector(".prompt-composer"),s=getComputedStyle(p);return{state:p.dataset.expanded,height:s.height,transition:s.transition,reduce:matchMedia("(prefers-reduced-motion:reduce)").matches,focus:document.activeElement===document.querySelector("textarea"),rect:p.getBoundingClientRect().toJSON()}})()')},null,2));
    assert.equal(Math.abs(opening.at(-1).height-high)<1,true,'composer reaches its expanded height');
    for(const sample of opening)assert.equal(sample.native.length===4&&sample.bottom*zoom<=Math.min(...sample.native)+2,true,'input cannot overlap native pages');
    assert.equal(events-beforeEvents,1,'native expansion uses one layout update');
    await win.webContents.insertText('Long question / 长问题 / 長問題\n'.repeat(40));
    await run('window.motionArea=document.querySelector("textarea");motionArea.setSelectionRange(17,43,"backward");motionArea.scrollTop=170');
    const before=await position();
    await click('[data-tier-icon="think"]');assert.deepEqual(await position(),before,'selection and scroll survive tier action');
    await click('textarea');
    const style=await run('(()=>{const e=document.querySelector("textarea"),s=getComputedStyle(e),p=getComputedStyle(e.parentElement);return{outline:s.outlineStyle,border:s.borderColor,shadow:p.boxShadow}})()');
    assert.equal(style.outline,'none');assert.equal(style.border,'rgba(0, 0, 0, 0)');assert.notEqual(style.shadow,'none');
    if(zoom===1){const r=await run('(()=>{const r=document.querySelector(".prompt-composer").getBoundingClientRect();return{x:Math.floor(r.x)-12,y:0,width:Math.ceil(r.width)+24,height:Math.ceil(r.bottom)+12}})()');writeFileSync(join(output,`${theme}-${density}.png`),(await win.webContents.capturePage(r)).toPNG())}
    const closing=await trace('[data-composer-toggle]');
    assert.equal(Math.abs(closing.at(-1).height-low)<1,true,'composer reaches its collapsed height');
    for(const sample of closing)assert.equal(sample.bottom*zoom<=Math.min(...sample.native)+2,true,'collapse retains native reserve until clear');
    assert.equal(events-beforeEvents,2,'native reserve is released once after collapse');
    const afterResize=await resizeCounts();assert.equal(afterResize.every((n,i)=>n-beforeResize[i]<=2),true,'webpages do not resize per animation frame');
    await click('[data-composer-toggle]');await pause(210);await click('[data-composer-toggle]');await pause(20);await click('[data-composer-toggle]');await pause(210);
    assert.equal(await run('document.querySelector("textarea")===window.motionArea'),true,'reversal retains textarea identity');
    assert.equal(await run('document.querySelector("[data-composer-toggle]").getAttribute("aria-expanded")'),'true');
    for(const selector of ['.scope-main','.image-trigger']){
      await click(selector);await pause(200);
      const pane=selector==='.scope-main'?'.workspace-drawer':'.image-tray';
      const bounds=nativeBounds();await click(pane+' .panel-close');await pause(20);
      assert.equal(await run(`document.querySelector(${JSON.stringify(pane)})?.hasAttribute('inert')`),true,'closing panel is inert');
      assert.deepEqual(nativeBounds(),bounds,'native width retained during panel exit');
      await wait(`!document.querySelector(${JSON.stringify(pane)})`);
    }
    await click('.question-trigger');await pause(200);
    assert.equal(views.every(v=>v.getVisible()),true,'wide history list keeps native pages visible in reserved space');
    await wait('!!document.querySelector(".question-main")');await click('.question-main');
    await wait('document.querySelector(".question-history")?.classList.contains("is-full")');await pause(60);
    assert.equal(views.every(v=>!v.getVisible()),true,'history covers attached native views');
    for(const v of views)assert.equal(await v.webContents.executeJavaScript('innerWidth>0&&innerHeight>0'),true);
    await click('.question-header .panel-close');await pause(20);
    assert.equal(await run('document.querySelector(".question-history")?.hasAttribute("inert")'),true);
    assert.equal(views.every(v=>!v.getVisible()),true,'native cover survives history exit');
    await wait('!document.querySelector(".question-history")');await pause(30);
    assert.equal(views.every(v=>v.getVisible()),true,'native pages restored after exit');
    reports.push({theme,density,zoom,delay,mode:manager.getLayout().mode,intermediateOpen:opening.filter(x=>x.height>low+1&&x.height<high-1).length,
      intermediateClose:closing.filter(x=>x.height>low+1&&x.height<high-1).length,resizeDeltas:afterResize.map((n,i)=>n-beforeResize[i]),style});
  }
  assert.equal(reports.some(r=>r.intermediateOpen>0)&&reports.some(r=>r.intermediateClose>0),true,'Chromium renders measured intermediate animation frames');
  const debug=await win.webContents.debugger;debug.attach('1.3');
  await debug.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click('[data-composer-toggle]');await wait('document.querySelector(".command-bar").getBoundingClientRect().height===64');
  assert.equal(await run('getComputedStyle(document.querySelector(".prompt-composer")).transitionDuration'),'0s');
  await debug.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
  await click('textarea');await pause(220);
  assert.equal(await run('getComputedStyle(document.querySelector(".prompt-composer")).outlineStyle'),'solid','system focus remains in forced colors');
  await debug.sendCommand('Emulation.setEmulatedMedia',{features:[]});debug.detach();
  for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Tab'});
  for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Tab',modifiers:['shift']});
  await wait('document.activeElement===document.querySelector("textarea")');
  assert.equal(await run('getComputedStyle(document.querySelector(".prompt-composer")).boxShadow.includes("inset")'),true,'keyboard focus retains the same bottom edge');
  writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
  console.log(`Native motion passed: ${reports.length} theme/density/zoom scenarios; delayed layout, four real views, selection, reversal, panels, reduced motion, forced colors and keyboard focus.`);
  win.destroy();app.exit(0);
}).catch(e=>{console.error(e.stack);app.exit(1)});
