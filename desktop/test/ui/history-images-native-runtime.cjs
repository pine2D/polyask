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
  const open=async(locale='en',theme='light',short=false,screen='history')=>{
    win.webContents.setZoomFactor(1);win.setContentSize(1200,short?600:900);nativeTheme.themeSource=theme;
    await win.loadFile(join(output,'index.html'),{query:{locale,screen}});
    win.webContents.setZoomFactor(short?1.5:1);win.show();win.focus();win.webContents.focus();
    await until('!!window.nativeImages?.ready','fixture ready');await js("window.addEventListener('keydown',e=>window.nativeLastKey={key:e.key,trusted:e.isTrusted},true)");await pause();boundary();
  };
  const snapshot=async(name)=>{
    await pause();const data=await js(`(()=>{const d=document.documentElement;return {width:innerWidth,height:innerHeight,scrollWidth:d.scrollWidth,overflow:d.scrollWidth>innerWidth+1,decoded:[...document.querySelectorAll('.question-attachments img,.question-image-dialog img')].map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,alt:i.alt}))};})()`);
    assert.equal(data.overflow,false,`${name}: no horizontal page overflow`);
    geometry.push({name,...data});writeFileSync(join(output,`${name}.png`),(await win.webContents.capturePage()).toPNG());boundary();
  };
  const read=async()=>{await until('!!document.querySelector(".question-main")','history list');await click('.question-main');await until('document.querySelectorAll(".question-attachments img").length===4 && [...document.querySelectorAll(".question-attachments img")].every(i=>i.complete&&i.naturalWidth===1)','four decoded PNG originals');};
  for(const locale of ['en','zh-CN','zh-TW'])for(const theme of ['light','dark'])for(const short of [false,true]){
    const name=`${locale}-${theme}-${short?'short-150':'normal-100'}`;
    await open(locale,theme,short);await read();
    await check(`JSON.stringify([...document.querySelectorAll('.question-attachments img')].map(i=>i.alt))===JSON.stringify(['first.png','second.png','first.png','last.png'])`,'ordered duplicates preserved');
    await snapshot(`${name}-history`);
    await js(`document.querySelector('[data-image-index="2"]').focus()`);await key('Enter');
    await until('!!document.querySelector(".question-image-dialog")','zoom opens');
    await check('document.querySelector(".question-image-dialog img").naturalWidth===1 && document.activeElement===document.querySelector(".question-image-dialog button")','decoded zoom and close focus');
    await key('Tab');await check('document.activeElement===document.querySelector(".question-image-dialog button")','zoom traps native Tab');
    await snapshot(`${name}-zoom`);await key('Escape');
    await check('!document.querySelector(".question-image-dialog") && document.activeElement===document.querySelector(\'[data-image-index="2"]\')','Escape closes zoom and returns focus');
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
    await check('document.activeElement.id==="backup-missing-title" && document.querySelectorAll(".backup-missing li").length===1','backup notice focus and count');
    await snapshot(`${name}-backup`);
    for (const selector of ['[data-export-mode=download]','[data-export-mode=text-only]','.backup-missing .settings-actions button:last-child']) {
      await key('Tab'); await check(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`,'backup choices follow native Tab order');
    }
    await snapshot(`${name}-backup-actions`);report.push({scenario:name,ok:true});
    console.log(JSON.stringify({scenario:name,ok:true}));
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
  writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),report,geometry,errors},null,2));
  if(win&&!win.isDestroyed())writeFileSync(join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());
  console.error(String(error.stack));if(win&&!win.isDestroyed())win.destroy();app.exit(1);
});
