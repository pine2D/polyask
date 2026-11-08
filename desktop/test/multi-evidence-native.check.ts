import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';
const conflict=process.env.POLYASK_EVIDENCE_CONFLICT_NATIVE==='1';
test('native comparison drafts and decisions save, review, delete and recover multiple excerpts', {timeout:180000},async()=>{
  const output=mkdtempSync(join(tmpdir(),'polyask-multi-evidence-'));
  console.log(`Multi-evidence native: ${output}`);
  for(const [entry,name,target] of [['test/ui/multi-evidence-native-fixture.tsx','bundle.js','web'],
    ['test/ui/multi-evidence-native-services.ts','services.cjs','electron-main']] as const) {
    await new Promise<void>((resolve,reject)=>{
      const compiler=webpack({mode:'development',context:join(__dirname,'..'),devtool:false,target,
        entry:join(__dirname,'..',entry),output:{path:output,filename:name,...(target==='electron-main'?{library:{type:'commonjs2'}}:{})},
        resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:'ts-loader',options:{transpileOnly:true}}]},
          {test:/\.css$/,use:['style-loader','css-loader']}]} });
      compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats?.toString({all:false,errors:true}))):resolve()));
    });
  }
  writeFileSync(join(output,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  writeFileSync(join(output,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('evidenceNative',{call:(name,args)=>ipcRenderer.invoke('evidence-native',name,args)});");
  const binary=require('electron') as string;
  const result=spawnSync('xvfb-run',['-a',binary,join(__dirname,'ui/multi-evidence-native-runtime.cjs'),output,...(conflict?['conflict']:[])],{encoding:'utf8',timeout:130000,
    env:{...process.env,ELECTRON_RUN_AS_NODE:'',DBUS_SESSION_BUS_ADDRESS:`unix:path=${output}/no-session-bus`,WAYLAND_DISPLAY:'',WAYLAND_SOCKET:''}});
  writeFileSync(join(output,'runtime.log'),result.stdout+'\n'+result.stderr);
  const boundary=join(output,'process-boundary.json');
  if(existsSync(boundary)) for(const pid of JSON.parse(readFileSync(boundary,'utf8')).observed) assert.equal(existsSync(`/proc/${pid}`),false,`process ${pid} exited`);
  rmSync(join(output,'profile'),{recursive:true,force:true});
  assert.equal(result.status,0,`Native evidence: ${output}; ${result.stdout}; ${result.error?.message??''}`);
  const report=JSON.parse(readFileSync(join(output,'report.json'),'utf8'));
  assert.equal(report.length,conflict?1:6); assert.equal(report.every((r:any)=>r.ok),true);
});
