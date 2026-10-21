// Isolated development-bundle native acceptance. All evidence remains in a generated temp directory.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';
const require=createRequire(import.meta.url),webpack=require('webpack');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const cssImports = path => [...readFileSync(path, 'utf8').matchAll(/import\s+["']([^"']+\.css)["']/g)].map(match => match[1].split('/').at(-1));
assert.equal(cssImports(join(root, 'test/ui/history-images-native-fixture.tsx')).join('|'), cssImports(join(root, 'src/renderer/index.tsx')).join('|'), 'native fixture must load all production global styles in the same order');
const output=mkdtempSync(join(tmpdir(),'polyask-history-images-native-'));
console.log(`Native original-image evidence: ${output}`);
const fault = process.argv.find(value => value.startsWith('--fault='))?.slice(8);
assert.equal(!fault || ['capture', 'timeout'].includes(fault), true, 'known synthetic failure mode');
const boundaryOutput = join(output, 'launcher-boundary'); mkdirSync(boundaryOutput);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const sample = processBoundary({ getAppMetrics: () => [] }, boundaryOutput);
const prepare = async () => {
  if (fault) return;
for(const [entry,filename,target] of [['test/ui/history-images-native-fixture.tsx','bundle.js','web'],['test/ui/history-images-native-services.ts','services.cjs','electron-main']]){
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:'development',context:root,devtool:false,target,entry:join(root,entry),
      output:{path:output,filename,...(target==='electron-main'?{library:{type:'commonjs2'}}:{})},
      resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[
        {test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:'ts-loader',options:{transpileOnly:true}}]},
        {test:/\.css$/,use:['style-loader','css-loader']}]}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
}
writeFileSync(join(output,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);
};
const binary=require('electron');
const result = await runOwnedNative({ command: 'xvfb-run',
  args: ['-a','-s','-screen 0 1920x1200x24',binary,join(root,'test/ui/history-images-native-runtime.cjs'),output],
  cwd: root, output, timeout: fault === 'timeout' ? 2000 : 120000, beforeSpawn: prepare,
  env: {...process.env,ELECTRON_RUN_AS_NODE:'',DBUS_SESSION_BUS_ADDRESS:`unix:path=${join(output,'no-session-bus')}`,
    POLYASK_HISTORY_NATIVE_FAULT: fault || ''},
  onSample: sample, onStdout: chunk => process.stdout.write(chunk),
  cleanupPaths: () => [join(output,'profile'),join(output,'synthetic-data')]
});
console.log(`Native original-image acceptance passed; profile removed; ${result.observed.length} owned processes exited`);
