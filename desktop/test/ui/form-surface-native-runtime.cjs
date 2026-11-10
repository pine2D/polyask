const {app,BrowserWindow,session,nativeTheme}=require('electron');
const {join}=require('node:path');
const {writeFileSync}=require('node:fs');
const {processBoundary}=require('./native-process-boundary.cjs');
const {nativeReadingTools}=require('./comparison-native-tools.cjs');
const output=process.argv[2],reports=[];
app.setPath('userData',join(output,'profile'));
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
  const win=new BrowserWindow({width:1280,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true}});
  win.setMenuBarVisibility(false);const boundary=processBoundary(app,output),errors=[],state={scenario:'',step:''};
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  const {js,until,click,key,type,check,failure}=nativeReadingTools(win,output,state);
  const paint=()=>js('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
  const shot=async name=>{await paint();writeFileSync(join(output,`${state.scenario}-${name}.png`),(await win.capturePage()).toPNG());};
  const geometry=()=>js(`(()=>({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,
    fields:[...document.querySelectorAll('input,textarea')].filter(n=>n.getClientRects().length).map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {name:n.name,font:parseFloat(s.fontSize),padding:parseFloat(s.paddingLeft),left:r.left,right:r.right};})}))()`);
  try{
    for(const surface of ['groups','templates'])for(const locale of ['en','zh-CN','zh-TW'])for(const theme of ['light','dark'])for(const zoom of [1,2]){
      state.scenario=`${surface}-${locale}-${theme}-${zoom}`;state.step='open';
      nativeTheme.themeSource=theme;win.setSize(zoom===1?1280:960,zoom===1?900:680);
      await win.loadFile(join(output,'index.html'),{query:{surface,locale,density:zoom===1?'compact':'comfortable'}});
      win.webContents.setZoomFactor(zoom);await until('window.formNative?.ready','fixture');await paint();
      await shot('initial');
      if(surface==='groups'){
        state.step='save-group';await type('[name=group-name]','Daily review 合成发送组');await shot('named');
        await click('.group-save button');await until('window.formNative.snapshot().groups.length===2','group saved');
        check(await js("document.querySelector('[name=group-name]').value===''") ,'successful group save clears only the name');
        await type('[name=group-name]','Duplicate group');
        check(await js("document.querySelector('.group-save button').disabled&&!!document.querySelector('#group-save-hint').textContent"),'duplicate scope is explained');
        await shot('duplicate');
        check(await js("(()=>{const r=document.querySelector('#group-save-hint').getBoundingClientRect(),panel=document.querySelector('.workspace-drawer').getBoundingClientRect();return r.bottom<=panel.bottom+1&&r.top>=panel.top-1;})()"),'group save feedback stays visible beside the field');
        await click('[data-group-id=saved] > button:last-child');await shot('delete-confirm');
        await click('.group-confirm button:last-child');check(await js("window.formNative.snapshot().groups.length===2"),'cancel preserves groups');
      }else{
        state.step='save-failure';await type('[name=prompt-template-name]','New reusable prompt');await click('.prompt-template-save button');
        await until("!!document.querySelector('.prompt-library [role=status]')",'save failure');
        const saveFailure=await js("document.querySelector('.prompt-library [role=status]').textContent");
        check(await js("document.querySelector('[name=prompt-template-name]').value==='New reusable prompt'"),'save failure preserves name');
        await shot('save-failure');
        state.step='variables';await click('.prompt-library-item > button:first-child');await shot('variables-empty');
        check(await js(`![...document.querySelectorAll('.prompt-library [role=status]')].some(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(saveFailure)})`),'save failure does not leak into the variable editor');
        check(await js("(()=>{const r=document.querySelector('.template-apply').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"),'template apply is visible while editing');
        check(await js("[...document.querySelectorAll('.prompt-variable-editor textarea')].every(n=>{const s=getComputedStyle(n);return parseFloat(s.fontSize)>=14&&parseFloat(s.paddingInlineStart)>=10;})"),'template fields have readable type and internal spacing');
        check(await js("document.querySelector('.template-apply').disabled"),'missing variables block apply');
        await type('[name=template-variable-0]','保留 {{literal}} $1 与用户输入');await type('[name=template-variable-1]','Synthetic source');
        await shot('variables-filled');
        check(await js("(()=>{const footer=document.querySelector('.prompt-variable-editor > footer').getBoundingClientRect(),surface=document.querySelector('.command-surface').getBoundingClientRect();return footer.bottom<=Math.min(innerHeight,surface.bottom)&&document.querySelector('.prompt-variable-fields').clientHeight>=48;})()"),'complete apply explanation fits and fields remain scrollable');
        await click('.template-apply');check(await js("window.formNative.snapshot().applied.includes('{{literal}} $1')"),'variables are filled once');
        await click('.prompt-variable-editor [data-template-back], .prompt-variable-editor > button');await until("document.activeElement===document.querySelector('.prompt-library-item > button:first-child')",'template focus returns');
      }
      const measure=await geometry();check(!measure.overflow,`${state.scenario}: page overflow`);
      check(measure.fields.every(f=>f.left>=-1&&f.right<=measure.width+1),`${state.scenario}: fields fit`);
      boundary();reports.push({scenario:state.scenario,ok:true,...measure});writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
    }
    for(const locale of ['en','zh-CN','zh-TW']){
      state.scenario=`groups-expanded-${locale}`;state.step='short-drawer';win.setSize(960,644);
      await win.loadFile(join(output,'index.html'),{query:{surface:'groups',locale,expanded:'1'}});win.webContents.setZoomFactor(2);
      await until('window.formNative?.ready','short drawer');await type('[name=group-name]','Expanded composer group');
      await click('.group-save button');await until('window.formNative.snapshot().groups.length===2','short drawer saves');
      await type('[name=group-name]','Duplicate group');await shot('duplicate');
      check(await js("(()=>{const r=document.querySelector('#group-save-hint').getBoundingClientRect(),p=document.querySelector('.workspace-drawer').getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=p.bottom+1;})()"),'expanded composer leaves feedback visible');
      await key('Escape');check(await js("document.querySelector('.workspace-drawer').getAttribute('aria-hidden')==='true'"),'short drawer still closes by keyboard');
      reports.push({scenario:state.scenario,ok:true});writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
    }
    win.webContents.debugger.attach('1.3');
    for(const scheme of ['light','dark']){
      state.scenario=`templates-forced-${scheme}`;state.step='forced-colors';
      win.setSize(960,680);nativeTheme.themeSource=scheme;
      await win.loadFile(join(output,'index.html'),{query:{surface:'templates',locale:'en',density:'comfortable'}});
      win.webContents.setZoomFactor(2);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'},{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]});
      await until('window.formNative?.ready','forced fixture');await click('.prompt-library-item > button:first-child');
      await type('[name=template-variable-0]','Readable {{literal}}');await type('[name=template-variable-1]','Source');await shot('filled');
      check(await js("(()=>{const n=document.querySelector('.template-apply'),r=n.getBoundingClientRect();return matchMedia('(forced-colors: active)').matches&&!n.disabled&&r.bottom<=document.querySelector('.command-surface').getBoundingClientRect().bottom;})()"),'forced colors retain the action');
      await click('.template-apply');check(await js("window.formNative.snapshot().applied.includes('{{literal}}')"),'forced-color action applies');
      reports.push({scenario:state.scenario,ok:true});writeFileSync(join(output,'report.json'),JSON.stringify(reports,null,2));
    }
    win.webContents.debugger.detach();
    check(errors.length===0,'no renderer errors');boundary();win.destroy();app.exit(0);
  }catch(error){await failure(error);win.destroy();throw error;}
}).catch(error=>{writeFileSync(join(output,'failure.txt'),String(error.stack));console.error(error);app.exit(1);});
