import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('production shell searches nine native pages with keyboard, lifecycle and full find-bar layout coverage', { timeout:420000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-site-find-native-'));
  writeFileSync(join(output, 'empty-preload.cjs'), '');
  for (const [entry, filename, target] of [
    ['src/renderer/index.tsx', 'bundle.js', 'web'],
    ['src/preload/shell.ts', 'preload.cjs', 'electron-preload'],
    ['test/ui/site-find-native-services.ts', 'services.cjs', 'electron-main']
  ] as const) await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode:'development', context:join(__dirname, '..'), devtool:false, target,
      entry:join(__dirname, '..', entry), output:{ path:output, filename,
        ...(target === 'electron-main' ? { library:{ type:'commonjs2' } } : {}) },
      resolve:{ extensions:['.tsx','.ts','.js'] },
      plugins:[new webpack.DefinePlugin({ SITE_WINDOW_PRELOAD_WEBPACK_ENTRY:JSON.stringify(join(output, 'empty-preload.cjs')) })],
      module:{ rules:[{ test:/\.tsx?$/, exclude:/node_modules/, use:[{ loader:'ts-loader', options:{ transpileOnly:true } }] },
        { test:/\.css$/, use:['style-loader','css-loader'] }] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all:false, errors:true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  for (const locale of ['en-US','zh-CN','zh-TW']) {
    const binary = require('electron') as string;
    const result = spawnSync(binary, [join(__dirname, 'ui/site-find-native-runtime.cjs'), output, locale, `--lang=${locale}`], {
      encoding:'utf8', timeout:120000, env:{ ...process.env, ELECTRON_RUN_AS_NODE:'', WAYLAND_DISPLAY:'', WAYLAND_SOCKET:'',
        ...(process.platform === 'linux' ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } : {}) }
    });
    if (process.platform === 'linux' && existsSync(join(output, 'process-boundary.json'))) {
      const { observed } = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')) as { observed: number[] };
      for (let round = 0; round < 20 && observed.some(pid => existsSync(`/proc/${pid}`)); round++) await new Promise(resolve => setTimeout(resolve, 50));
      const remaining = observed.filter(pid => existsSync(`/proc/${pid}`));
      writeFileSync(join(output, 'cleanup-' + locale + '.json'), JSON.stringify({ remainingObservedPids: remaining }));
      assert.equal(remaining.length, 0, 'observed Electron processes exit');
    }
    rmSync(join(output, 'profile-' + locale), { recursive: true, force: true });
    console.log(`Find native evidence (${locale}): ${output}\n${result.stdout}`);
    if (result.error || !result.stdout.includes('SITE_FIND_NATIVE_COMPLETE')) console.log(`${result.stderr}\n${result.error ?? ''}`);
    assert.equal(result.error === undefined, true, String(result.error ?? ''));
    assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
    assert.equal(result.stdout.includes('SITE_FIND_NATIVE_COMPLETE'), true);
  }
});
