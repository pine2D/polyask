import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('production shell keeps explicit composer intent and consistent field focus in native windows', { timeout: 180000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-composer-activation-'));
  writeFileSync(join(output, 'empty-preload.cjs'), '');
  for (const [entry, name, target] of [
    ['src/renderer/index.tsx', 'bundle.js', 'web'],
    ['src/preload/shell.ts', 'preload.cjs', 'electron-preload'],
    ['src/main/view-manager.ts', 'manager.cjs', 'electron-main']
  ] as const) await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false, target,
      entry: join(__dirname, '..', entry), output: { path: output, filename: name, ...(target === 'electron-main' ? { library: { type: 'commonjs2' } } : {}) },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, plugins: [new webpack.DefinePlugin({ SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(join(output, 'empty-preload.cjs')) })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/composer-activation-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 120000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '' } });
  console.log(`Composer activation evidence: ${output}\n${result.stdout}`);
  assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
});
