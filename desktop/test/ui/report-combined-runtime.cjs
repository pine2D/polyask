const {app,BrowserWindow,session,ipcMain,nativeTheme}=require('electron');
const {join}=require('node:path');
const {writeFileSync}=require('node:fs');
const {processBoundary}=require('./native-process-boundary.cjs');
const output=process.argv[2], report=[], conflict=false;
app.setPath('userData',join(output,'profile'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(value,message)=>{if(!value)throw Error(message);};
app.whenReady().then(async()=>{
  const {DesktopDatabase,ArchiveService,DecisionService,DraftRepository,ReportExportService,renderReportDiagrams,printReportPdf,renderReportMath,renderReportHtml,createArchiveRecord}=require(join(output,'services.cjs'));
  let db,archives,decisions,drafts,source,conflictNext=false,preparedPrompt='';
  let httpRequests=0;
  const dense=createArchiveRecord({text:'Dense formulas',task:'Dense formulas',results:[{host:'claude.ai',label:'Claude',
    text:Array.from({length:1000},(_,i)=>`$x_{${i}}+\\frac{a}{b}$`).join(' ')}]},{id:'dense',now:100,deviceId:'native'});
  const collectMath=new Map();renderReportHtml({kind:'archive',archive:dense},'en',{collectMath});
  let beats=0,last=Date.now(),maxGap=0;
  const heartbeat=setInterval(()=>{beats++;maxGap=Math.max(maxGap,Date.now()-last);last=Date.now();},1);
  const math=await renderReportMath(collectMath,{signal:new AbortController().signal,guard:()=>{}});
  clearInterval(heartbeat);
  check(math.size===256&&beats>2,'dense formulas yield to main event loop');
  const controller=new AbortController();let guards=0;
  const cancellation=renderReportMath(collectMath,{signal:controller.signal,guard:()=>{guards++;}});
  setImmediate(()=>controller.abort());let cancelled=false;
  try{await cancellation;}catch(error){cancelled=error.message==='report_source_changed';}
  check(cancelled&&guards<10,'dense formula cancellation responds before finishing');
  writeFileSync(join(output,'dense-formulas.json'),JSON.stringify({sourceCount:1000,rendered:math.size,beats,maxGap,cancelled,guards}));
  for(const name of ['polyask-reports','polyask-report-render']) session.fromPartition(name).webRequest.onBeforeSendHeaders({urls:['http://*/*','https://*/*']},(details,cb)=>{httpRequests++;cb({requestHeaders:details.requestHeaders});});
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
  const win=new BrowserWindow({width:1280,height:1000,show:true,webPreferences:{sandbox:true,contextIsolation:true,preload:join(output,'preload.cjs')}});
  win.setMenuBarVisibility(false);
  const sample=processBoundary(app,output);
  const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  ipcMain.handle('evidence-native',(_event,name,args)=>{
    const api={prepareSyntheticAnswers:prompt=>{preparedPrompt=prompt;source=archives.add({text:prompt,task:prompt,results:source.results});return source;},getArchive:()=>source,createDecision:value=>decisions.create(value),updateDecision:(id,value)=>{
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
  for(const locale of ['en','zh-CN','zh-TW'])for(const width of [1280]){
    if(db)db.close();db=DesktopDatabase.open(':memory:');db.meta.put('deviceId','native');
    archives=new ArchiveService(db.archives,{deviceId:()=> 'native',now:()=>100,createId:()=> 'native-source'});
    source=archives.add({text:'Synthetic decision question',task:'Compare costs',results:[
      {host:'claude.ai',label:'Claude',observation:{questionId:'combined-question',site:'claude',attempt:1,observedAt:100,selection:{requested:'think',observed:'think',outcome:'preferred',model:'COMBINED_OBSERVATION'}},text:'First excerpt.\nSecond excerpt.\nAdditional original context.\n\n$x^2$\n\n```mermaid\ngraph TD; A[Evidence]-->B[Decision]\n```'},
      {host:'chatgpt.com',label:'ChatGPT',text:'Independent cost evidence.\nMore saved context.'}]});
    decisions=new DecisionService(db.decisions,archives,{deviceId:()=> 'native'});drafts=new DraftRepository(db.state,db.meta);
    nativeTheme.themeSource=locale==='en'?'dark':'light';win.setSize(width,1000);
    await win.loadFile(join(output,'index.html'),{query:{locale,combined:'1'}});
    await until('!!document.querySelector("#task-opener")','setup mounted');await click('#task-opener');
    await until('!!document.querySelector("[name=task-preset]")','setup shown');
    await type('[name=task-dimensions]','Cost and evidence');await type('[name=task-output]','Decision report');
    await click('[data-task-apply]');
    await until('!!document.querySelector(".confirm-actions .primary")','draft confirmation');await click('.confirm-actions .primary');
    await until('!!document.querySelector(".manual-comparison")','prepared answers mounted');
    check(preparedPrompt.includes('Cost and evidence')&&preparedPrompt.includes('Decision report'),'prepared prompt reaches actual SQLite archive');
    check(await js('window.taskNative.snapshot().broadcasts===0&&window.taskNative.snapshot().sessions===0'),'setup did not send or navigate');
    await click('.manual-comparison > summary');await until('!!document.querySelector(".answer-excerpt-open")','comparison sources opened');await add(0,0);await add(0,1);await add(1,0);
    check(await js('document.querySelectorAll(".manual-quote").length===3'),'three retained passages');
    for(const selector of ['[name=comparison-topic-0-0]','[name=comparison-topic-0-1]','[name=comparison-topic-1-0]'])await type(selector,'Cost');
    await type('[name=comparison-note-evidence-0]','Keep all four note categories.');
    await until('document.querySelectorAll("[data-evidence-topic=Cost] blockquote").length===3','cross-source topic group');
    await click('[data-evidence-topic=Cost] .evidence-overview-item:nth-child(3) button');
    await until('!!document.querySelector("[name=evidence-review-original]")','original review');
    check(await js(`(()=>{const n=document.querySelector('[name=evidence-review-original]');return n.value.slice(n.selectionStart,n.selectionEnd)==='Second excerpt.';})()`),'exact second original passage selected');
    await key('Escape');await key('Tab');check(await js("document.activeElement!==document.body"),'keyboard focus after review');
    for(let i=0;i<100&&!drafts.list('comparison').some(d=>d.content.quotes.length===3&&d.content.quotes.every(q=>q.topic==='Cost'));i++)await pause(30);
    const persisted=drafts.list('comparison')[0];check(persisted?.format===2,'format2 comparison draft persisted');
    const ids=persisted.content.quotes.map(q=>q.id);check(new Set(ids).size===3,'stable unique identities persisted');
    await button('manualFormDecision');await until('!!document.querySelector(".decision-editor")','decision draft mounted');
    await button('decisionSave');await until('!!document.querySelector(".decision-editor[data-editing=false]")','decision saved');
    const card=decisions.search()[0];check(card.schema===6&&card.evidence.length===3,'real service saved all excerpts');
    check(card.evidence.map(e=>e.id).join(',')===ids.join(','),'comparison ids persist through decision save');
    const reportLocale={en:'en','zh-CN':'zhCN','zh-TW':'zhTW'}[locale];
    const exporter=new ReportExportService({archives,decisions,epoch:()=>0,isCurrent:()=>!win.isDestroyed(),
      choosePath:async request=>join(output,`${reportLocale}.${request.format}`),printPdf:printReportPdf,
      renderDiagrams:(sources,options)=>renderReportDiagrams(sources,options,join(output,'report-preload.cjs'))});
    for(const format of ['html','pdf'])check((await exporter.export({kind:'decision',id:card.id,format,locale:reportLocale})).status==='saved','actual report service wrote '+format);
    check(BrowserWindow.getAllWindows().length===1,'all trusted render and PDF windows released');
    const html=require('node:fs').readFileSync(join(output,`${reportLocale}.html`),'utf8');
    check(html.includes('COMBINED_OBSERVATION')&&html.includes('data:image/png;base64,')&&html.includes('<math '),'static visuals and observed model retained');
    check(card.evidence.length===3&&card.sourceUpdatedAt===source.updatedAt,'every independent excerpt retains reviewed version');
    for(const evidence of card.evidence)check(html.includes(evidence.excerpt),'report retains '+evidence.id);
    exporter.dispose();
    await js("document.querySelector('.evidence-overview').scrollIntoView({block:'center'})");await pause(80);
    const geometry=await js(`(()=>{const n=document.querySelector('.decision-editor');return {width:n.clientWidth,scroll:n.scrollWidth,body:document.body.scrollWidth,viewport:innerWidth};})()`);
    check(geometry.scroll<=geometry.width+1&&geometry.body<=geometry.viewport+1,'no horizontal overflow');
    sample();const name=`${locale}-${width}`;writeFileSync(join(output,`${name}.png`),(await win.capturePage()).toPNG());
    report.push({locale,width,ok:true,httpRequests,preparedPrompt,steps:[...(conflict?['backend-source100-to101','save-conflict-retains-edits','explicit-reviewed-version','save101-stable-ids']:[]),'task-setup-real-hooks','draft-confirmation','prepared-prompt-sqlite','synthetic-answer-comparison','native-select-three','topic-group','original-range','keyboard-return','format2-save','schema6-decision-save','static-html-pdf'],geometry,ids});
    writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
  }
  check(httpRequests===0,'no HTTP report traffic');
  check(errors.length===0,`renderer errors: ${errors.join(';')}`);sample();db.close();win.destroy();app.exit(0);
}).catch(error=>{writeFileSync(join(output,'failure.txt'),String(error.stack));console.log(String(error.stack));app.exit(1);});
