import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url), webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'polyask-question-paging-'));
console.log('History paging native evidence: ' + output);
const launcher = join(output, 'launcher'); mkdirSync(launcher);
const sample = require('../test/ui/native-process-boundary.cjs').processBoundary({ getAppMetrics: () => [] }, launcher);
const prepare = () => new Promise((resolve, reject) => {
  const compiler = webpack({ mode:'development', context:root, devtool:false,
    entry:join(root, 'test/ui/question-paging-native-fixture.tsx'), output:{ path:output, filename:'bundle.js' },
    resolve:{ extensions:['.tsx','.ts','.js'] }, module:{ rules:[
      { test:/\.tsx?$/, exclude:/node_modules/, use:[{ loader:'ts-loader', options:{ transpileOnly:true } }] },
      { test:/\.css$/, use:['style-loader','css-loader'] }
    ] } });
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || Error(stats.toString({ all:false, errors:true }))) : resolve()));
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
});
const result = await runOwnedNative({ command:'xvfb-run',
  args:['-a','-s','-screen 0 1920x1200x24',require('electron'),join(root, 'test/ui/question-paging-native-runtime.cjs'),output],
  cwd:root, output, timeout:60000, beforeSpawn:prepare, onSample:sample, onStdout:chunk => process.stdout.write(chunk),
  env:{ ...process.env, ELECTRON_RUN_AS_NODE:'', WAYLAND_DISPLAY:'', WAYLAND_SOCKET:'',
    DBUS_SESSION_BUS_ADDRESS:'unix:path=' + join(output, 'no-session-bus') },
  cleanupPaths:() => [join(output, 'profile')]
});
const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
assert.equal(report.cases.length, 3); assert.equal(report.network, 0);
console.log('History paging passed at 100/150/200%; ' + result.observed.length + ' owned processes exited; temporary profile removed.');
