const {app,BrowserWindow,session,ipcMain,nativeTheme}=require('electron');
const {join}=require('node:path');
const {writeFileSync}=require('node:fs');
const {processBoundary}=require('./native-process-boundary.cjs');
const output=process.argv[2], report=[], conflict=process.argv[3]==='conflict', focus=process.argv[3]==='focus';
app.setPath('userData',join(output,'profile'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(value,message)=>{if(!value)throw Error(message);};
app.whenReady().then(async()=>{
  const {DesktopDatabase,ArchiveService,DecisionService,DraftRepository}=require(join(output,'services.cjs'));
  let db,archives,decisions,drafts,source,conflictNext=false;
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
  const win=new BrowserWindow({width:1280,height:1000,show:true,webPreferences:{sandbox:true,contextIsolation:true,preload:join(output,'preload.cjs')}});
  win.setMenuBarVisibility(false);
  const sample=processBoundary(app,output);
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  ipcMain.handle('evidence-native',(_event,name,args)=>{
    const api={getArchive:()=>source,createDecision:value=>decisions.create(value),updateDecision:(id,value)=>{
      if(conflictNext){conflictNext=false;source={...source,updatedAt:101};db.archives.put(source);}
      return decisions.update(id,value);
    },
      listDrafts:(kind,context)=>({epoch:drafts.epoch(),deviceId:'native',drafts:drafts.list(kind,context)}),
      saveDraft:(value,epoch)=>drafts.save(value,epoch),removeDraft:(id,stamp,epoch)=>drafts.remove(id,stamp,epoch)};
    if(!api[name])throw Error(`unavailable fixture operation ${name}`);return api[name](...args);
  });
  const js=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(error){writeFileSync(join(output,'failure.png'),(await win.capturePage()).toPNG());writeFileSync(join(output,'failure-dom.html'),await win.webContents.executeJavaScript('document.body.outerHTML'));throw Error(`${code}\n${errors.join(';')}\n${error}`);}};
  const until=async(code,message)=>{for(let i=0;i<120;i++){if(await js(code))return;await pause(25);}throw Error(message);};
  const click=async selector=>{
    win.focus();win.webContents.focus();
    const rect=await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)throw Error('missing '+${JSON.stringify(selector)});n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...rect});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...rect});await pause(70);
  };
  const key=async(keyCode,modifiers=[])=>{win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await pause(45);};
  const type=async(selector,text)=>{await click(selector);await key('a',['control']);win.webContents.insertText(text);await pause(70);};
  const button=async(copyKey,scope='document')=>{
    await js(`(()=>{const n=[...${scope}.querySelectorAll('button')].find(n=>n.textContent===window.evidenceCopy[${JSON.stringify(copyKey)}]);if(!n)throw Error('missing button '+${JSON.stringify(copyKey)});n.dataset.nativeTarget='true';})()`);
    await click('[data-native-target=true]');await js("document.querySelector('[data-native-target]')?.removeAttribute('data-native-target')");
  };
  const add=async(sourceIndex,line)=>{
    await click(`.manual-comparison-source:nth-child(${sourceIndex+1}) .answer-excerpt-open`);
    await click('[name=answer-excerpt-original]');
    const points=await js(`(()=>{const n=document.querySelector('[name=answer-excerpt-original]'),r=n.getBoundingClientRect(),s=getComputedStyle(n),c=document.createElement('canvas').getContext('2d');c.font=s.font;
      const x=r.x+n.clientLeft+parseFloat(s.paddingLeft),y=r.y+n.clientTop+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)*(${line}+.5);
      return {start:{x:Math.round(x+1),y:Math.round(y)},end:{x:Math.round(x+c.measureText(n.value.split('\\n')[${line}]).width+2),y:Math.round(y)}};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.start});
    win.webContents.sendInputEvent({type:'mouseMove',button:'left',...points.end});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.end});await pause(100);
    writeFileSync(join(output,'selection.json'),JSON.stringify(await js(`(()=>{const n=document.querySelector('[name=answer-excerpt-original]');return {start:n.selectionStart,end:n.selectionEnd,active:document.activeElement===n,value:n.value};})()`)));
    await until('!!document.querySelector(".excerpt-confirm-preview")','native original selection');
    await button('excerptUseSelection',"document.querySelector('.folder-modal')");
    await button('excerptManualCompare',`document.querySelector('.manual-comparison-source:nth-child(${sourceIndex+1})')`);
  };
  for(const locale of (conflict||focus?['zh-CN']:['en','zh-CN','zh-TW']))for(const width of (conflict||focus?[640]:[1280,640])){
    if(db)db.close();db=DesktopDatabase.open(':memory:');db.meta.put('deviceId','native');
    archives=new ArchiveService(db.archives,{deviceId:()=> 'native',now:()=>100,createId:()=> 'native-source'});
    source=archives.add({text:'Synthetic decision question',task:'Compare costs',results:[
      {host:'claude.ai',label:'Claude',text:'First excerpt.\nSecond excerpt.\nAdditional original context.'},
      {host:'chatgpt.com',label:'ChatGPT',text:'Independent cost evidence.\nMore saved context.'}]});
    decisions=new DecisionService(db.decisions,archives,{deviceId:()=> 'native'});drafts=new DraftRepository(db.state,db.meta);
    nativeTheme.themeSource=locale==='en'?'dark':'light';win.setSize(width,1000);
    await win.loadFile(join(output,'index.html'),{query:{locale}});await until('!!document.querySelector(".manual-comparison")','comparison mounted');
    await click('.manual-comparison > summary');await until('!!document.querySelector(".answer-excerpt-open")','comparison sources opened');if(focus){
      await add(0,0);
      const first=await js('document.activeElement.dataset.comparisonEvidence');check(typeof first==='string','first excerpt focused by stable id');
      await add(0,1);
      const second=await js('document.activeElement.dataset.comparisonEvidence');check(typeof second==='string'&&second!==first,'second excerpt focused by distinct stable id');
      check(await js("document.activeElement.value==='Second excerpt.'"),'second excerpt is focus target');
      await add(0,1);
      check(await js('document.querySelectorAll(".manual-quote").length===2&&!document.activeElement.matches("[data-comparison-evidence]")'),'duplicate rejection does not focus retained excerpt');
      await click('.manual-quote button');
      check(await js('!document.activeElement.matches("[data-comparison-evidence]")'),'deletion does not consume stale focus');
      await add(0,2);
      const third=await js('document.activeElement.dataset.comparisonEvidence');
      check(typeof third==='string'&&third!==first&&third!==second,'new excerpt focused after earlier deletion');
      check(await js(`document.activeElement.value==='Additional original context.'&&document.querySelector('[data-comparison-evidence]').dataset.comparisonEvidence===${JSON.stringify(second)}`),'remaining identity and new focus retained');
      sample();writeFileSync(join(output,'focus-zh-CN-640.png'),(await win.capturePage()).toPNG());
      report.push({locale,width,ok:true,steps:['first-stable-id-focus','second-stable-id-focus','duplicate-no-focus','delete-no-stale-focus','add-after-delete-focus'],ids:[first,second,third]});
      writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));continue;
    }
    await add(0,0);await add(0,1);await add(1,0);
    check(await js('document.querySelectorAll(".manual-quote").length===3'),'three retained passages');
    for(const selector of ['[name=comparison-topic-0-0]','[name=comparison-topic-0-1]','[name=comparison-topic-1-0]'])await type(selector,'Cost');
    await type('[name=comparison-note-evidence-0]','Keep all four note categories.');
    writeFileSync(join(output,`${locale}-${width}-manual-notes.png`),(await win.capturePage()).toPNG());
    await until('document.querySelectorAll("[data-evidence-topic=Cost] blockquote").length===3','cross-source topic group');
    await click('[data-evidence-topic=Cost] .evidence-overview-item:nth-child(3) button');
    await until('!!document.querySelector("[name=evidence-review-original]")','original review');
    check(await js(`(()=>{const n=document.querySelector('[name=evidence-review-original]');return n.value.slice(n.selectionStart,n.selectionEnd)==='Second excerpt.';})()`),'exact second original passage selected');
    writeFileSync(join(output,`${locale}-${width}-original-review.png`),(await win.capturePage()).toPNG());
    check(await js("parseFloat(getComputedStyle(document.querySelector('[name=evidence-review-original]')).paddingInlineStart)>=10"),'original review text has deliberate internal spacing');
    await key('Escape');await key('Tab');check(await js("document.activeElement!==document.body"),'keyboard focus after review');
    for(let i=0;i<100&&!drafts.list('comparison').some(d=>d.content.quotes.length===3&&d.content.quotes.every(q=>q.topic==='Cost'));i++)await pause(30);
    const persisted=drafts.list('comparison')[0];check(persisted?.format===2,'format2 comparison draft persisted');
    const ids=persisted.content.quotes.map(q=>q.id);check(new Set(ids).size===3,'stable unique identities persisted');
    await win.loadFile(join(output,'index.html'),{query:{locale}});await until('!!document.querySelector(".manual-comparison")','remounted comparison');
    await click('.manual-comparison > summary');await until('!!document.querySelector(".draft-recovery-entry")','draft recovery available');
    await click('.draft-recovery-entry > summary');await button('draftReview');await button('draftRestore');
    await until('document.querySelectorAll(".manual-quote").length===3','all passages recovered');
    check(await js('document.querySelectorAll("[data-evidence-topic=Cost] blockquote").length===3'),'topics restored');
    await button('manualFormDecision');await until('!!document.querySelector(".decision-editor")','decision draft mounted');
    await button('decisionSave');await until('!!document.querySelector(".decision-editor[data-editing=false]")','decision saved');
    const card=decisions.search()[0];check(card.schema===6&&card.evidence.length===3,'real service saved all excerpts');
    check(card.evidence.map(e=>e.id).join(',')===ids.join(','),'comparison ids persist through decision save');
    if(conflict){
      await button('decisionEdit');await type('[name=decision-title]','Pending judgment after source update');conflictNext=true;
      await button('decisionSave');await until('!!document.querySelector("[data-evidence-use-reviewed]")','conflict refresh offers explicit review');
      check(decisions.search()[0].sourceUpdatedAt===100,'conflict did not save or adopt version101');
      check(await js("document.querySelector('[name=decision-title]').value==='Pending judgment after source update'"),'conflict retains edited title');
      await js("document.querySelector('.decision-source-conflict').scrollIntoView({block:'center'})");await pause(80);
      writeFileSync(join(output,'source-conflict-zh-CN-640.png'),(await win.capturePage()).toPNG());
      await js("document.querySelector('[data-evidence-use-reviewed]').scrollIntoView({block:'center'})");await pause(80);
      writeFileSync(join(output,'source-review-zh-CN-640.png'),(await win.capturePage()).toPNG());
      await click('[data-evidence-use-reviewed]');await button('decisionSave');
      await until('!!document.querySelector(".decision-editor[data-editing=false]")','reviewed conflict saved');
      const reviewed=decisions.search()[0];check(reviewed.sourceUpdatedAt===101&&reviewed.title==='Pending judgment after source update','explicit reviewed version persisted');
      check(reviewed.evidence.map(e=>e.id).join(',')===ids.join(','),'conflict recovery retains stable identities');
    }
    await button('decisionEdit');await click('.decision-excerpt header button');await button('decisionSave');
    await until('!!document.querySelector(".decision-editor[data-editing=false]")','single removal saved');
    const after=decisions.search()[0];check(after.evidence.length===2&&after.evidence[0].id===ids[1],'single deletion retains second same-source identity');
    await click('[data-evidence-topic=Cost] button');await until('!!document.querySelector("[name=evidence-review-original]")','saved evidence review');await key('Escape');
    await js("document.querySelector('.evidence-overview').scrollIntoView({block:'center'})");await pause(80);
    const geometry=await js(`(()=>{const n=document.querySelector('.decision-editor');return {width:n.clientWidth,scroll:n.scrollWidth,body:document.body.scrollWidth,viewport:innerWidth};})()`);
    check(geometry.scroll<=geometry.width+1&&geometry.body<=geometry.viewport+1,'no horizontal overflow');
    sample();const name=`${locale}-${width}`;writeFileSync(join(output,`${name}.png`),(await win.capturePage()).toPNG());
    report.push({locale,width,ok:true,steps:[...(conflict?['backend-source100-to101','save-conflict-retains-edits','explicit-reviewed-version','save101-stable-ids']:[]),'native-select-three','topic-group','original-range','keyboard-return','format2-save','reload-recover','schema6-decision-save','single-delete','saved-review'],geometry,ids});
    writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
  }
  check(errors.length===0,`renderer errors: ${errors.join(';')}`);sample();db.close();win.destroy();app.exit(0);
}).catch(error=>{writeFileSync(join(output,'failure.txt'),String(error.stack));console.log(String(error.stack));app.exit(1);});
