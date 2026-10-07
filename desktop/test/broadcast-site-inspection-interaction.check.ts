import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('production root inspection refuses closed sites and waits for explicit manual reselection', async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-root-inspection-'));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({mode:'development', context:join(__dirname,'..'), devtool:false,
      entry:join(__dirname,'ui/broadcast-inspection-fixture.tsx'), output:{path:output,filename:'bundle.js'},
      resolve:{extensions:['.tsx','.ts','.js']}, module:{rules:[
        {test:/\.tsx?$/,exclude:/node_modules/,use:[{loader:'ts-loader',options:{transpileOnly:true}}]},
        {test:/\.css$/,use:['style-loader','css-loader']}
      ]}});
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({all:false,errors:true}))) : resolve()));
  });
  writeFileSync(join(output,'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  const binary = require('electron') as string, args = [join(__dirname,'ui/broadcast-inspection-runtime.cjs'),output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless?'xvfb-run':binary, headless?['-a',binary,...args]:args,
    {encoding:'utf8',timeout:45000,env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
  writeFileSync(join(output,'runtime.log'), `${result.stdout}\n${result.stderr}`);
  console.log(`Root inspection evidence: ${output}`);
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr}`);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'report.json'),'utf8')),
    {ok:true,nativeInput:true,closedSiteBlocked:true,mainRejectionVisible:true,simulatedDriveRace:true,manualReselectionFocused:true,sends:1});
});
