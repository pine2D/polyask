const { join } = require('node:path');
const { writeFileSync } = require('node:fs');

// 所有原生输入都先核对当前 CSS 命中，再换算为 Electron 的缩放前坐标。
exports.nativeReadingTools = (win, output, state) => {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const js = async source => {
    let result;
    try { result = await win.webContents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (0,eval)(${JSON.stringify(source)})};}
      catch(error){return {ok:false,name:String(error?.name||'Error').slice(0,32),message:String(error?.message||'renderer_error').replace(/\\s+/g,' ').slice(0,160)};}})()`); }
    catch (error) { result = { ok: false, name: 'ExecuteError', message: String(error.message).slice(0, 160) }; }
    if (!result.ok) {
      writeFileSync(join(output, 'renderer-error.json'), JSON.stringify({ scenario: state.scenario, step: state.step,
        sourcePrefix: source.replace(/\s+/g, ' ').slice(0, 80), name: result.name, message: result.message }, null, 2));
      throw new Error(`${state.scenario}/${state.step}: renderer ${result.name}; see renderer-error.json`);
    }
    return result.value;
  };
  const pause = () => js('new Promise(resolve=>setTimeout(resolve,30))');
  const until = async (source, label) => {
    for (let i = 0; i < 150; i++) { if (await js(source)) return; await pause(); }
    writeFileSync(join(output, 'timeout.json'), JSON.stringify({ scenario: state.scenario, step: state.step, label,
      zoom: win.webContents.getZoomFactor(), lastInput: state.lastInput }, null, 2));
    throw new Error(`${state.scenario}/${state.step}: timed out ${label}`);
  };
  const focus = async () => { win.focus(); await until('document.hasFocus()', 'native focus'); };
  const key = async (keyCode, modifiers = []) => {
    await focus();
    await js(`(()=>{window.readingNativeKey=null;document.addEventListener('keydown',event=>{
      const input=window.readingNativeKey={trusted:event.isTrusted,key:event.key,code:event.code,keyCode:event.keyCode,ctrl:event.ctrlKey,shift:event.shiftKey,
        originalTarget:event.target===document.querySelector('[name=answer-excerpt-original]'),baselineTarget:event.target===document.querySelector('[name=native-key-baseline]'),defaultPrevented:event.defaultPrevented};
      setTimeout(()=>{input.defaultPrevented=event.defaultPrevented;},0);
    },{once:true,capture:true});})()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await pause();
    state.lastInput = { type: 'key', driver: 'electron-send-input-event', keyCode, modifiers, actual: await js('window.readingNativeKey') };
  };
  const point = async selector => js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
    const outer=()=>document.querySelector('.archive-detail-pane')?.scrollTop??null,beforePositioning=outer();
    const center=()=>{const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}};
    const hit=p=>{const target=document.elementFromPoint(p.x,p.y);return target===node||node.contains(target)};
    let p=center();if(!hit(p)){node.scrollIntoView({block:'nearest'});p=center();}return hit(p)?{...p,outerBeforePositioning:beforePositioning,outerAfterPositioning:outer()}:null;})()`);
  const click = async selector => {
    await focus(); const target = await point(selector); check(!!target, `missing visible control ${selector}`);
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});window.comparisonNativeHit=null;
      document.addEventListener('click',event=>{window.comparisonNativeHit={trusted:event.isTrusted,hit:node===event.target||node.contains(event.target),x:event.clientX,y:event.clientY,outerAtClick:document.querySelector('.archive-detail-pane')?.scrollTop??null};},{once:true,capture:true});})()`);
    const zoom = win.webContents.getZoomFactor(), sent = { x: Math.round(target.x * zoom), y: Math.round(target.y * zoom) };
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...sent });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...sent }); await pause();
    state.lastInput = { selector, zoom, expected: target, sent, actual: await js('window.comparisonNativeHit') };
    check(state.lastInput.actual?.trusted && state.lastInput.actual?.hit, `native input missed ${selector}`);
  };
  const type = async (selector, text) => { await click(selector); await key('A', ['control']); await win.webContents.insertText(text); await pause(); };
  const wheel = async (selector, deltaY) => {
    await focus(); const target = await point(selector); check(!!target, `missing wheel target ${selector}`);
    const zoom = win.webContents.getZoomFactor(), sent = { x: Math.round(target.x * zoom), y: Math.round(target.y * zoom) };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...sent });
    // 真实指针转移后让上一段滚轮手势结束，避免 Chromium 将新列继续锁到旧列。
    await js('new Promise(resolve=>setTimeout(resolve,160))');
    const measure = () => js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect();
      return {target:{clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,overflowY:getComputedStyle(node).overflowY,hover:node.matches(':hover'),x:r.x,y:r.y,width:r.width,height:r.height},
        columns:[...document.querySelectorAll('.archive-compare-column')].map(column=>({top:column.scrollTop,clientHeight:column.clientHeight,scrollHeight:column.scrollHeight})),outer:document.querySelector('.archive-detail-pane')?.scrollTop??null};})()`);
    const before = await measure();
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});window.readingNativeWheel=null;
      document.addEventListener('wheel',event=>{window.readingNativeWheel={trusted:event.isTrusted,hit:node===event.target||node.contains(event.target),deltaY:event.deltaY,defaultPrevented:event.defaultPrevented};},{once:true,capture:true});})()`);
    // 此驱动参数沿 DOM 正向向下；Electron 原生输入正值实测生成相反的 DOM deltaY。
    win.webContents.sendInputEvent({ type: 'mouseWheel', ...sent, deltaY: -deltaY, deltaX: 0, canScroll: true });
    let last = '', stable = 0;
    for (let round = 0; round < 20 && stable < 4; round++) {
      await pause(); const sample = await measure();
      const vector = JSON.stringify({ columns: sample.columns.map(column => column.top), outer: sample.outer, target: sample.target.scrollTop });
      stable = vector === last ? stable + 1 : 0; last = vector;
    }
    state.lastInput = { type: 'wheel', selector, zoom, point: target, requestedDeltaY: deltaY, sentDeltaY: -deltaY,
      actual: await js('window.readingNativeWheel'), before, after: await measure(), settled: stable >= 4 };
    state.wheels ??= []; state.wheels.push(state.lastInput);
    writeFileSync(join(output, 'wheel.json'), JSON.stringify(state.wheels, null, 2));
    check(state.lastInput.actual?.trusted && state.lastInput.actual?.hit, `native wheel missed ${selector}`);
    check(state.lastInput.after.target.hover && state.lastInput.settled, `native wheel did not settle on ${selector}`);
  };
  const selectPlain = async selector => {
    await focus(); const visible = await point(selector); check(!!visible, 'plain source is visible');
    const rect = await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),range=document.createRange();
      range.selectNodeContents(node);const r=range.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    const zoom = win.webContents.getZoomFactor(), start = { x: Math.round((rect.x + 1) * zoom), y: Math.round((rect.y + rect.height / 2) * zoom) };
    const end = { x: Math.round((rect.x + rect.width + 2) * zoom), y: start.y };
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});window.readingNativeSelection=null;
      document.addEventListener('pointerup',event=>{window.readingNativeSelection={trusted:event.isTrusted,hit:node===event.target||node.contains(event.target),length:window.getSelection()?.toString().length||0};},{once:true,capture:true});})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...start });
    win.webContents.sendInputEvent({ type: 'mouseMove', button: 'left', ...end });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...end }); await pause();
    state.lastInput = { type: 'selection', selector, zoom, actual: await js('window.readingNativeSelection') };
    check(state.lastInput.actual?.trusted && state.lastInput.actual?.hit && state.lastInput.actual.length > 0, `native selection missed ${selector}`);
  };
  const selectOriginalLine = async selector => {
    await focus();
    const geometry = await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;
      const r=node.getBoundingClientRect(),style=getComputedStyle(node),line=node.value.split('\\n')[0];
      const paddingLeft=parseFloat(style.paddingLeft),paddingRight=parseFloat(style.paddingRight),paddingTop=parseFloat(style.paddingTop),lineHeight=parseFloat(style.lineHeight);
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d');context.font=style.fontStyle+' '+style.fontWeight+' '+style.fontSize+' '+style.fontFamily;
      const spacing=parseFloat(style.letterSpacing)||0,width=context.measureText(line).width+spacing*Math.max(0,line.length-1);
      const x=r.x+node.clientLeft+paddingLeft,y=r.y+node.clientTop+paddingTop+lineHeight/2;
      const start={x:Math.round(x+1),y:Math.round(y)},end={x:Math.round(x+width+2),y:Math.round(y)};
      return {start,end,length:line.length,width,paddingLeft,paddingRight,paddingTop,borderLeft:node.clientLeft,borderTop:node.clientTop,lineHeight,
        scrollTop:node.scrollTop,scrollLeft:node.scrollLeft,safe:line.length>0&&style.direction==='ltr'&&Number.isFinite(lineHeight)&&node.scrollTop===0&&node.scrollLeft===0
          &&width+3<node.clientWidth-paddingLeft-paddingRight&&document.elementFromPoint(start.x,start.y)===node&&document.elementFromPoint(end.x,end.y)===node};})()`);
    const zoom=win.webContents.getZoomFactor();
    state.lastInput={type:'textarea-selection',driver:'electron-native-pointer',selector,zoom,geometry,actual:null};
    writeFileSync(join(output,'raw-pointer.json'),JSON.stringify(state.lastInput,null,2));
    check(geometry?.safe, 'complete first original line is visible and unobscured');
    await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),probe=window.readingNativeRawPointer={down:null,up:null,changes:0,trustedChange:false};
      const sample=event=>({trusted:event.isTrusted,hit:event.target===node,start:node.selectionStart,end:node.selectionEnd});
      const down=event=>{probe.down=sample(event);},up=event=>{probe.up=sample(event);},changed=event=>{
        if(document.activeElement===node){probe.changes++;probe.trustedChange=probe.trustedChange||event.isTrusted;}};
      document.addEventListener('pointerdown',down,{once:true,capture:true});document.addEventListener('pointerup',up,{once:true,capture:true});
      document.addEventListener('selectionchange',changed);node.addEventListener('select',changed);
      window.readingNativeRawCleanup=()=>{document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);
        document.removeEventListener('selectionchange',changed);node.removeEventListener('select',changed);};})()`);
    const scaled=point=>({x:Math.round(point.x*zoom),y:Math.round(point.y*zoom)});
    try {
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...scaled(geometry.start)});
      win.webContents.sendInputEvent({type:'mouseMove',button:'left',...scaled(geometry.end)});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...scaled(geometry.end)});await pause();
      const actual=await js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return {...window.readingNativeRawPointer,
        active:document.activeElement===node,start:node.selectionStart,end:node.selectionEnd};})()`);
      state.lastInput={type:'textarea-selection',driver:'electron-native-pointer',selector,zoom,geometry,actual};
      writeFileSync(join(output,'raw-pointer.json'),JSON.stringify(state.lastInput,null,2));
      check(actual.down?.trusted&&actual.down?.hit&&actual.up?.trusted&&actual.up?.hit&&actual.active&&actual.changes>0&&actual.trustedChange,'trusted pointer selects the current original control');
      check(actual.start===0&&actual.end===geometry.length,'native pointer selects exactly the first continuous original line');
    } finally { await js('window.readingNativeRawCleanup?.();delete window.readingNativeRawCleanup'); }
  };
  const geometry = async name => js(`(()=>({name:${JSON.stringify(name)},viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,
    controlOverflow:[...document.querySelectorAll('button,input,textarea,summary')].filter(node=>node.getClientRects().length).some(node=>{const r=node.getBoundingClientRect();return r.x< -1||r.right>innerWidth+1})}))()`);
  const failure = async error => {
    writeFileSync(join(output, 'failure.json'), JSON.stringify({ scenario: state.scenario, step: state.step,
      lastInput: state.lastInput, message: String(error.message).replace(/\s+/g, ' ').slice(0, 180) }, null, 2));
    if (!win.isDestroyed()) writeFileSync(join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG());
  };
  return { check, js, pause, until, key, click, type, wheel, selectPlain, selectOriginalLine, geometry, failure };
};
