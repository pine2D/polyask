const {app,BrowserWindow,session,nativeTheme}=require('electron');
const {join}=require('node:path');
const {writeFileSync,mkdirSync,statSync}=require('node:fs');
const assert=require('node:assert/strict');
const {processBoundary}=require('./native-process-boundary.cjs');
const output=process.argv[2];
app.setPath('userData',join(output,'profile'));
app.setPath('sessionData',join(output,'profile','sessions'));
app.on('window-all-closed',()=>{});
let win,boundary;
const errors=[],report=[],geometry=[];
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,done)=>done({cancel:true}));
  win=new BrowserWindow({width:1200,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  boundary=processBoundary(app,output);
  const fault = process.env.POLYASK_HISTORY_NATIVE_FAULT;
  if (fault) {
    mkdirSync(join(output,'synthetic-data'));
    writeFileSync(join(output,'synthetic-data','owned-marker'),'synthetic');
    if (fault === 'capture') {
      win.webContents.capturePage = async () => { throw new Error('injected_capture_failure'); };
      throw new Error('injected_native_failure');
    }
    require('node:child_process').spawn(process.execPath,
      ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
      {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore'});
    process.on('SIGTERM',()=>{});
    await new Promise(()=>{});
  }
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(String(event.message));});
  win.webContents.on('render-process-gone',(_,detail)=>errors.push(`renderer:${detail.reason}`));
  const js=source=>win.webContents.executeJavaScript(source);
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  const until=async(source,label)=>{const end=Date.now()+6000;while(Date.now()<end){if(await js(source))return;await pause();}throw new Error(`timeout: ${label}`);};
  const check=async(source,label)=>assert.equal(await js(source),true,label);
  const key=async(keyCode,modifiers=[])=>{if(keyCode==='Enter')keyCode='Return';win.focus();win.webContents.focus();await until('document.hasFocus()','native keyboard focus');await js('window.nativeLastKey=null');win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Return')win.webContents.sendInputEvent({type:'char',keyCode:'\r'});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause();await check('window.nativeLastKey?.trusted===true','native trusted key delivered');};
  const click=async(selector)=>{
    const point=await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('missing click target');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    const zoom=win.webContents.getZoomFactor(),x=Math.round(point.x*zoom),y=Math.round(point.y*zoom);
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await pause();
  };
  const label=async name=>{await js(`(()=>{document.querySelectorAll('[data-native-button]').forEach(n=>n.removeAttribute('data-native-button'));const b=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===window.nativeImages.copy[${JSON.stringify(name)}]);if(!b)throw new Error('missing label ${name}');b.setAttribute('data-native-button','true');})()`);return '[data-native-button]';};
  const open=async(locale='en',theme='light',short=false,screen='history',extra={})=>{
    win.webContents.setZoomFactor(1);win.setContentSize(1200,short?600:900);nativeTheme.themeSource=theme;
    await win.loadFile(join(output,'index.html'),{query:{locale,screen,...extra}});
    win.webContents.setZoomFactor(short?1.5:1);win.show();win.focus();win.webContents.focus();
    await until('!!window.nativeImages?.ready','fixture ready');await js(`document.documentElement.dataset.density=${JSON.stringify(short?'comfortable':'compact')}`);await js("window.addEventListener('keydown',e=>window.nativeLastKey={key:e.key,trusted:e.isTrusted},true)");await pause();boundary();
  };
  const snapshot=async(name)=>{
    await pause();const data=await js(`(()=>{const d=document.documentElement,r=document.querySelector('.question-image-dialog')?.getBoundingClientRect();return {viewerContained:!r||(r.left>=11&&r.top>=11&&r.right<=innerWidth-11&&r.bottom<=innerHeight-11),width:innerWidth,height:innerHeight,scrollWidth:d.scrollWidth,overflow:d.scrollWidth>innerWidth+1,decoded:[...document.querySelectorAll('.question-attachments img,.question-image-dialog img')].map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,alt:i.alt,displayWidth:i.getBoundingClientRect().width,displayHeight:i.getBoundingClientRect().height}))};})()`);
    assert.equal(data.overflow,false,`${name}: no horizontal page overflow`);
    assert.equal(data.viewerContained,true,`${name}: complete viewer and outer margins remain inside the window`);
    geometry.push({name,...data});writeFileSync(join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());boundary();
  };
  const read=async()=>{await until('!!document.querySelector(".question-main")','history list');await click('.question-main');await until('document.querySelectorAll(".question-attachments img").length===4 && [...document.querySelectorAll(".question-attachments img")].every(i=>i.complete&&i.naturalWidth>0)','four decoded PNG originals');};
  for(const locale of ['en','zh-CN','zh-TW'])for(const theme of ['light','dark'])for(const short of [false,true]){
    const name=`${locale}-${theme}-${short?'short-150':'normal-100'}`;
    await open(locale,theme,short);await read();
    await check(`JSON.stringify([...document.querySelectorAll('.question-attachments img')].map(i=>i.alt))===JSON.stringify(['first.png','second.png','first.png','last.png'])`,'ordered duplicates preserved');
    await snapshot(`${name}-history`);
    await js(`document.querySelector(\'[data-image-index="1"]\').focus()`);await key('Enter');
    await until('!!document.querySelector(".question-image-dialog")','zoom opens');
    await check('document.querySelector(".question-image-dialog img").naturalWidth===640 && document.activeElement===document.querySelector(".question-image-close")','decoded portrait and close focus');
    await check('document.querySelector("#question-image-title").textContent.includes("2 / 4") && document.querySelector("#question-image-title").textContent.includes("second.png")','visible filename and sequence');
    await check('(()=>{const v=document.querySelector(".question-image-viewport"),i=v.querySelector("img").getBoundingClientRect();return i.width<=v.clientWidth+1&&i.height<=v.clientHeight+1;})()','fit contains the complete portrait');
    await snapshot(`${name}-zoom-fit`);
    await key('Tab');await check('document.activeElement===document.querySelector(".question-image-viewport")','Tab reaches keyboard image viewport');
    await key('Tab');await check('document.activeElement===document.querySelector(".question-image-controls button")','Tab wraps to fit control');
    await key('Tab');await key('Enter');
    await check('document.querySelector(".question-image-dialog").dataset.size==="actual" && Math.abs(document.querySelector(".question-image-dialog img").getBoundingClientRect().height-960)<1','100% displays original pixel dimensions');
    await key('Tab');await key('Tab');await key('PageDown');
    await check('document.querySelector(".question-image-viewport").scrollTop>0','trusted PageDown scrolls original');
    await snapshot(`${name}-zoom-actual`);
    await click(await label('questionOriginalFit'));
    await check('document.querySelector(".question-image-dialog").dataset.size==="fit" && document.querySelector(".question-image-viewport").scrollTop===0','fit resets image scroll');
    await key('Escape');
    await check('!document.querySelector(".question-image-dialog") && document.activeElement===document.querySelector(\'[data-image-index="1"]\')','Escape returns to the originating thumbnail');
    await click(await label('questionReask'));
    await until('!!document.querySelector(".confirm-dialog")','dirty-draft confirmation');
    await check('window.nativeImages.state().applied===0 && window.nativeImages.state().draft.includes("Unsent")','dirty draft retained before confirmation');
    await js('document.querySelector(".confirm-actions .primary").focus()');await key('Enter');
    await until('window.nativeImages.state().applied===1','reask applied');
    await check('window.nativeImages.state().sends===0 && JSON.stringify(window.nativeImages.state().names)===JSON.stringify(window.nativeImages.images.map(i=>i.name)) && window.nativeImages.state().draft===window.nativeImages.question.text','full atomic reask and no send');
    await open(locale,theme,short,'settings');
    await until('!!document.querySelector(\'input[name="question-image-sync"]\')','settings image switch');
    await js('document.querySelector(\'input[name="question-image-sync"]\').focus()');await key('Space');
    await until('!!document.querySelector(".confirm-dialog")','sync scope confirmation');
    await snapshot(`${name}-sync-confirm`);
    await check('document.querySelector("#confirm-message").textContent.includes("EXIF") && document.querySelector("#confirm-message").textContent.includes("Google Drive")','scope warning visible');
    await key('Escape');await check('!document.querySelector(".confirm-dialog") && window.nativeImages.evidence.settings.length===0','Escape cancels enable');
    await js('document.querySelector(\'input[name="question-image-sync"]\').focus()');await key('Space');
    await until('!!document.querySelector(".confirm-dialog")','sync confirmation reopens');
    await js('document.querySelector(".confirm-actions .primary").focus()');await key('Enter');
    await until('document.querySelector(\'input[name="question-image-sync"]\').checked','confirmed enable');
    await click(await label('syncNow'));await until('window.nativeImages.evidence.syncPending','manual sync pending');
    await check('!document.querySelector(\'input[name="question-image-sync"]\').disabled','disable available while sync pending');
    await js('document.querySelector(\'input[name="question-image-sync"]\').focus()');await key('Space');
    await check('!document.querySelector(\'input[name="question-image-sync"]\').checked && window.nativeImages.evidence.syncPending && JSON.stringify(window.nativeImages.evidence.settings)==="[true,false]"','disabled before pending manual sync completes');
    await js('window.nativeImages.finishSync()');
    await open(locale,theme,short,'backup');await click(await label('backupExport'));
    await until('!!document.querySelector(".backup-missing")','missing original backup choices');
    await check('document.activeElement.id==="backup-missing-title" && document.querySelectorAll(".backup-missing li").length===8','backup notice focus and count');
    await snapshot(`${name}-backup`);
    for (const selector of ['.backup-missing ul','.backup-missing .settings-actions button:first-child','[data-export-mode=text-only]','.backup-missing .settings-actions button:last-child']) {
      await key('Tab'); await check(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`,'backup choices follow native Tab order');
    }
    await snapshot(`${name}-backup-actions`);
    await key('Enter');
    const returned = '(()=>{const el=document.activeElement,r=el.getBoundingClientRect(),body=document.querySelector(".settings-body").getBoundingClientRect();return el.textContent===window.nativeImages.copy.backupExport && r.top>=body.top && r.bottom<=body.bottom;})()';
    await check(returned,'cancel restores visible export entry');
    await snapshot(`${name}-backup-cancelled`);
    await click(await label('backupExport'));await click(await label('backupGoImageSync'));
    await check('document.activeElement.id==="question-image-sync-title" && document.querySelectorAll(".backup-missing li").length===8 && window.nativeImages.evidence.settings.length===0','settings guidance preserves task without enabling sync');
    await js('document.querySelector(\'input[name="question-image-sync"]\').focus()');await key('Space');
    await until('!!document.querySelector(".confirm-dialog")','guided enable confirmation');
    await js('document.querySelector(".confirm-actions .primary").focus()');await key('Enter');
    await click('[data-settings-section=backup]');
    await click('[data-export-mode=download]');
    await check('window.nativeImages.evidence.backupModes.includes("download") && !!document.querySelector(".backup-missing")','download becomes available without losing the pending task');
    await click('[data-export-mode=text-only]');await check(returned,'completed export restores visible export entry');
    await snapshot(`${name}-backup-complete`);report.push({scenario:name,ok:true});
    console.log(JSON.stringify({scenario:name,ok:true}));
  }
  for(const [locale,theme] of [['en','dark'],['zh-TW','light']]){
    await open(locale,theme,true,'history',{long:'1'});win.webContents.setZoomFactor(2);await read();
    if(locale==='en')await js('document.documentElement.dataset.density="compact"');
    await click('[data-image-index="2"]');
    await check('document.querySelector("#question-image-title bdi").textContent===window.nativeImages.images[2].name && document.querySelector("#question-image-title").textContent.includes("3 / 4")','full long filename and sequence at 200%');
    await snapshot(`${locale}-long-landscape-fit-200`);
    win.webContents.sendInputEvent({type:'mouseDown',x:2,y:2,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',x:2,y:2,button:'left',clickCount:1});await pause();
    await check('document.activeElement===document.querySelector(".question-image-dialog")','backdrop click focuses the viewer panel');
    await key('Tab',['shift']);await check('document.activeElement===document.querySelector(".question-image-viewport")','reverse Tab after backdrop stays in viewer');
    await click(await label('questionOriginalActual'));
    await js('document.querySelector(".question-image-viewport").focus()');await key('Right');await key('PageDown');
    await check('(()=>{const v=document.querySelector(".question-image-viewport"),i=v.querySelector("img").getBoundingClientRect();return Math.abs(i.width-1600)<1&&Math.abs(i.height-900)<1&&v.scrollLeft>0&&v.scrollTop>0;})()','100% landscape supports both keyboard scroll axes');
    await snapshot(`${locale}-long-landscape-actual-200`);
    await js('document.querySelector(".question-image-controls button").focus()');await key('Tab',['shift']);
    await check('document.activeElement===document.querySelector(".question-image-viewport")','reverse Tab wraps to image viewport');
    await key('Escape');report.push({scenario:`${locale}-long-landscape-200`,ok:true});
  }
  for(const action of ['edit','reset','close','navigate']){
    await open();await read();await js('window.nativeImages.delay(true)');await click(await label('questionReask'));
    if(action==='edit')await js('window.nativeImages.edit("Newer draft")');
    if(action==='reset')await js('window.nativeImages.reset()');
    if(action==='close')await click('.panel-close');
    if(action==='navigate')await click('.question-header button');
    await js('window.nativeImages.release()');await pause();
    await check('window.nativeImages.state().applied===0 && window.nativeImages.state().sends===0 && !document.querySelector(".confirm-dialog")',`late reask suppressed: ${action}`);
    if(action==='reset')await check('window.nativeImages.state().draft==="" && window.nativeImages.state().names.length===0','reset cannot revive draft');
    report.push({scenario:`stale-${action}`,ok:true});
  }
  await open();await until('!!document.querySelector(".question-main")','missing-set list');await js('window.nativeImages.missing()');await click('.question-main');
  await until('!!document.querySelector(".question-attachments [role=alert]")','missing originals');
  await check('document.querySelectorAll(".question-attachments img").length===0','missing images not silently fabricated');
  await click(await label('questionOriginalFetch'));await until('document.querySelectorAll(".question-attachments img").length===4','explicit download refresh');
  report.push({scenario:'explicit-fetch-refresh',ok:true});
  for(const failed of [true,false])for(const moved of [false,true]){
    await open('en','light',true,'backup');
    await js('window.nativeImages.sync({state:"idle",connected:true,pending:0,errorCount:0,readOnly:false,oauthConfigured:true,secureTokenStorage:true,imageSyncEnabled:true})');
    await click(await label('backupExport'));await js('window.nativeImages.holdDownload()');
    await click('[data-export-mode=download]');await check('document.querySelector("[data-export-mode=download]").disabled','download pending disables its entry');
    if(moved)await click('[data-settings-section=overview]');
    await js(`window.nativeImages.releaseDownload(${failed})`);await until('!document.querySelector("[data-export-mode=download]").disabled','unfinished download permits retry');
    await check(moved?'document.activeElement.id==="sync-title"':'document.activeElement===document.querySelector("[data-export-mode=download]")','unfinished download restores lost focus and preserves deliberate navigation');
    const scenario=`download-${failed?'failed':'incomplete'}-${moved?'moved':'restored'}-focus`;
    if(!moved)await snapshot(scenario);report.push({scenario,ok:true});
  }
  // Real production SQLite/BLOB/v4 services under Electron, independent of the UI's synthetic bridge.
  const {DesktopDatabase,BackupService,originals,question}=require(join(output,'services.cjs'));
  const data=join(output,'synthetic-data');mkdirSync(data);
  const db=DesktopDatabase.open(join(data,'source.sqlite')),other=DesktopDatabase.open(join(data,'restored.sqlite'));
  const service=new BackupService(db,{deviceId:()=> 'native-source',stagingRoot:data});
  const restore=new BackupService(other,{deviceId:()=> 'native-target',stagingRoot:data});
  try{
    const q=question('native-originals',4);db.questions.put(q);db.questionAttachments.save(q,originals);
    const path=join(data,'roundtrip.polyask');await service.exportFile(path);
    const preview=await restore.previewFile(path);assert.equal(preview.items.length,2);
    assert.equal(restore.apply(preview.token,preview.items.map(i=>i.key)).imported,2);
    assert.equal(JSON.stringify(other.questionAttachments.readAll(q.id)),JSON.stringify(originals));
    const before=db.questions.lifecycle;db.meta.put('deviceId','retained-native-device');db.meta.put('questionImageSyncEnabled',true);
    db.resetLocalData();assert.equal(db.questions.lifecycle>before,true);assert.equal(db.meta.get('deviceId'),'retained-native-device');assert.equal(db.meta.get('questionImageSyncEnabled'),null);
    assert.equal(db.questionAttachments.all().length,0);
    report.push({scenario:'electron-sqlite-v4-reset',ok:true,bytes:statSync(path).size});
  }finally{service.dispose();restore.dispose();db.close();other.close();}
  boundary();assert.equal(errors.length,0,`renderer errors: ${errors.join(';')}`);
  writeFileSync(join(output,'report.json'),JSON.stringify({report,geometry,errors,proof:'Production components and services, synthetic bridge; not full-application IPC'},null,2));
  win.destroy();app.exit(0);
}).catch(async error=>{
  // Capture can itself reject after renderer failure. Preserve the first error and always exit.
  console.error(String(error.stack));
  try {
    writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),report,geometry,errors},null,2));
    try {
      if(win&&!win.isDestroyed())writeFileSync(join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
    } catch (captureError) { console.error(`failure_screenshot_unavailable:${captureError}`); }
  } catch (evidenceError) { console.error(`failure_evidence_unavailable:${evidenceError}`); }
  finally { try { if(win&&!win.isDestroyed())win.destroy(); } finally { app.exit(1); } }
});
