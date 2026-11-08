import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('native task preparation flows through SQLite comparison, multiple excerpts and static report exports', {timeout:180000},async()=>{
  const output=mkdtempSync(join(tmpdir(),'polyask-report-combined-'));
  console.log(`Report combined native: ${output}`);
  for(const [entry,name,target] of [['test/ui/report-combined-fixture.tsx','bundle.js','web'],
    ['test/ui/report-combined-services.ts','services.cjs','electron-main'],
    ['src/preload/report-render.ts','report-preload.cjs','electron-preload']] as const) {
    await new Promise<void>((resolve,reject)=>{
      const compiler=webpack({mode:'development',context:join(__dirname,'..'),devtool:false,target,
        entry:join(__dirname,'..',entry),output:{path:output,filename:name,...(target==='electron-main'?{library:{type:'commonjs2'}}:{})},
        plugins:target==='electron-preload'?[new webpack.optimize.LimitChunkCountPlugin({maxChunks:1})]:[],
        resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:'ts-loader',options:{transpileOnly:true}}]},
          {test:/\.css$/,use:['style-loader','css-loader']}]} });
      compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||Error(stats?.toString({all:false,errors:true}))):resolve()));
    });
  }
  writeFileSync(join(output,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  writeFileSync(join(output,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('evidenceNative',{call:(name,args)=>ipcRenderer.invoke('evidence-native',name,args)});");
  const binary=require('electron') as string;
  const result=spawnSync('xvfb-run',['-a',binary,join(__dirname,'ui/report-combined-runtime.cjs'),output],{encoding:'utf8',timeout:130000,
    env:{...process.env,ELECTRON_RUN_AS_NODE:'',DBUS_SESSION_BUS_ADDRESS:`unix:path=${output}/no-session-bus`,WAYLAND_DISPLAY:'',WAYLAND_SOCKET:''}});
  writeFileSync(join(output,'runtime.log'),result.stdout+'\n'+result.stderr);
  const boundary=join(output,'process-boundary.json');
  if(existsSync(boundary)) for(const pid of JSON.parse(readFileSync(boundary,'utf8')).observed) assert.equal(existsSync(`/proc/${pid}`),false,`process ${pid} exited`);
  rmSync(join(output,'profile'),{recursive:true,force:true});
  assert.equal(result.status,0,`Native evidence: ${output}; ${result.stdout}; ${result.error?.message??''}`);
  const report=JSON.parse(readFileSync(join(output,'report.json'),'utf8'));
  assert.equal(report.length,3); assert.equal(report.every((r:any)=>r.ok),true);
});
