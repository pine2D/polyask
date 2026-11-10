const {join}=require('node:path');
const {writeFileSync}=require('node:fs');

// 用真实排版和原生输入验证表单，不用 JSX 快照代替可读性与操作可达性。
exports.taskSetupVisual=async({win,output,nativeTheme,js,until,click,key,open,select,sample,check})=>{
  const report=[],cases=[];
  for(const locale of ['en','zh-CN','zh-TW'])for(const theme of ['light','dark'])for(const density of ['compact','comfortable'])
    for(const width of [1280,640])cases.push({locale,theme,density,width,zoom:1,forced:false});
  for(const locale of ['en','zh-CN','zh-TW'])for(const theme of ['light','dark'])
    cases.push({locale,theme,density:'comfortable',width:960,zoom:2,forced:false});
  for(const theme of ['light','dark'])cases.push({locale:'en',theme,density:'comfortable',width:960,zoom:2,forced:true});
  for(const locale of ['zh-CN','zh-TW','en'])for(const theme of ['dark','light'])
    cases.unshift({locale,theme,density:'comfortable',width:960,height:680,zoom:2,forced:false});
  win.webContents.debugger.attach('1.3');
  const settle=()=>js('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const capture=async name=>{await settle();writeFileSync(join(output,`${name}.png`),(await win.capturePage()).toPNG());};
  const bounds=()=>js(`(()=>{
    const panel=document.querySelector('.task-setup'),body=panel.querySelector('.task-setup-body');
    const visible=node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;};
    return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1||panel.scrollWidth>panel.clientWidth+1||body.scrollWidth>body.clientWidth+1,
      header:visible(panel.querySelector('header')),apply:visible(panel.querySelector('[data-task-apply]')),bodyHeight:body.clientHeight,
      controlOverflow:[...panel.querySelectorAll('select,textarea,button')].some(node=>{const r=node.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;})};
  })()`);
  for(const c of cases){
    const name=`visual-${c.locale}-${c.theme}-${c.density}-${c.width}-x${c.zoom}${c.height?'-short':''}${c.forced?'-forced':''}`;
    nativeTheme.themeSource=c.theme;win.setSize(c.width,c.height??1000);
    await win.loadFile(join(output,'index.html'),{query:{locale:c.locale,density:c.density}});
    win.webContents.setZoomFactor(c.zoom);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:c.forced?
      [{name:'forced-colors',value:'active'},{name:'prefers-reduced-motion',value:'reduce'}]:[]});
    await until('window.taskNative?.snapshot().images===1','visual fixture ready');
    await open();await settle();
    const initial=await bounds();
    await capture(name);
    check(!initial.overflow&&!initial.controlOverflow,`${name}: controls fit the viewport`);
    check(initial.header&&initial.apply&&initial.bodyHeight>=96,`${name}: header, body and action stay usable`);
    const fields=await js(`(()=>[...document.querySelectorAll('.task-setup textarea')].map(node=>{
      const s=getComputedStyle(node);return {name:node.name,paddingX:parseFloat(s.paddingInlineStart),paddingY:parseFloat(s.paddingBlockStart),
        font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight),readOnly:node.readOnly,background:s.backgroundColor};}))()`);
    check(fields.every(f=>f.paddingX>=10&&f.paddingY>=8&&f.font>=14&&f.line/f.font>=1.5),`${name}: readable field geometry`);
    const preview=fields.find(f=>f.name==='task-preview'),editor=fields.find(f=>f.name==='task-text');
    check(preview.readOnly&&!editor.readOnly,`${name}: preview remains read-only`);
    if(!c.forced)check(preview.background!==editor.background,`${name}: preview has a distinct surface`);
    else check(await js("matchMedia('(forced-colors:active)').matches&&matchMedia('(prefers-reduced-motion:reduce)').matches"),`${name}: accessibility media active`);
    await key('Tab');
    check(await js("document.activeElement.name==='task-preset'&&document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2"),`${name}: keyboard focus is visible`);
    await click('[name=task-text]');
    check(await js("document.activeElement.name==='task-text'&&getComputedStyle(document.activeElement).boxShadow!=='none'" )||c.forced,`${name}: editing focus is visible`);
    await js("document.querySelector('.task-setup-body').scrollTop=1e6");await settle();
    const scrolled=await bounds();check(scrolled.header&&scrolled.apply,`${name}: scrolling keeps actions visible`);
    await click('[name=task-preview]');await key('Tab');await key('Tab',['shift']);
    check(await js("document.activeElement.name==='task-preview'&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2"),`${name}: preview keyboard focus is visible`);
    if(c.zoom===2||c.width===640)await capture(`${name}-preview`);
    if(c.locale==='zh-CN'&&c.theme==='light'&&c.width===1280&&c.density==='compact'){
      const enabledColor=await js("getComputedStyle(document.querySelector('[data-task-apply]')).backgroundColor");
      await select('task-template',1);await js("document.querySelector('.task-setup-body').scrollTop=0");
      check(await js("(()=>{const r=document.querySelector('.task-setup-invalid')?.getBoundingClientRect();return document.querySelector('[data-task-apply]').disabled&&!!r&&r.top>=0&&r.bottom<=innerHeight;})()"),'empty variables explain disabled apply next to the action');
      check(await js(`getComputedStyle(document.querySelector('[data-task-apply]')).backgroundColor!==${JSON.stringify(enabledColor)}`),'disabled apply looks different from the available action');
      await capture('visual-template-incomplete');
    }
    if(c.locale==='zh-CN'&&c.theme==='light'&&c.zoom===2){
      await select('task-template',2);await click('[name=task-variable-0]');
      await win.webContents.insertText('较长的任务输入需要完整保留，并可在最终预览中滚动核对。'.repeat(100));await settle();
      const long=await bounds();check(!long.overflow&&!long.controlOverflow&&long.apply,'long variable labels and content fit the narrow viewport');
      check(await js("document.querySelector('[name=task-variable-0]').value.length>2000&&document.querySelector('[name=task-preview]').value.includes('较长的任务输入')"),'long input reaches the live preview');
      await capture(`visual-long-template-200${c.height?'-short':''}`);
    }
    if(c.locale==='en'&&c.theme==='light'&&c.zoom===2){
      await select('task-tier',1);await js("window.taskNative.configure('tier')");
      await click('[data-task-apply]');await until('!!document.querySelector(".confirm-actions .primary")','zoomed draft confirmation');
      await click('.confirm-actions .primary');await until("window.taskNative.snapshot().error==='failed'",'zoomed failure feedback');
      await capture(`visual-failure-en-200${c.height?'-short':''}`);
      const failed=await bounds();check(failed.apply&&failed.header&&failed.bodyHeight>=96,'failure feedback leaves zoomed form usable');
      check(await js("(()=>{const r=document.querySelector('.task-setup-error').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()"),'zoomed failure remains visible');
    }
    await key('Escape');check(await js("document.activeElement.id==='task-opener'&&!window.taskNative.snapshot().open"),`${name}: Escape restores opener`);
    sample();report.push({...c,ok:true,initial,scrolled,fields});
    writeFileSync(join(output,'visual-report.json'),JSON.stringify(report,null,2));
  }
  win.webContents.debugger.detach();
};
