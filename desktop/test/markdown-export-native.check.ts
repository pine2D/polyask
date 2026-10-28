import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpack from 'webpack';
test('native Markdown selection, production preload and IPC write one bounded file without network', { timeout: 180000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-markdown-native-'));
  console.log(`Markdown native evidence: ${output}`);
  const compile = (entry: string, filename: string, target: string) => new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), target, devtool: false, entry,
      output: { path: output, filename, ...(target === 'electron-main' ? { library: { type: 'commonjs2' } } : {}) },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  await compile(join(__dirname, 'ui/markdown-export-native-fixture.tsx'), 'bundle.js', 'web');
  await compile(join(__dirname, 'ui/markdown-export-native-services.ts'), 'services.cjs', 'electron-main');
  await compile(join(__dirname, '../src/preload/shell.ts'), 'preload.cjs', 'electron-preload');
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  const { runOwnedNative } = require('../scripts/lib/owned-native-process.mjs');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/markdown-export-native-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = await runOwnedNative({ command: headless ? 'xvfb-run' : binary, args: headless ? ['-a', '-s', '-screen 0 1920x1200x24', binary, ...args] : args,
    cwd: join(__dirname, '..'), output, timeout: 120000, onStdout: (chunk: string) => process.stdout.write(chunk),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
      ...(process.platform === 'linux' ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } : {}) },
    cleanupPaths: () => [join(output, 'profile')] });
  assert.equal(result.live.length, 0); assert.equal(result.errors.length, 0);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.cases.length, 18); assert.equal(report.network, 0); assert.equal(report.cancelled, 18);
  assert.equal(report.files.length, 21); assert.equal(report.errors.length, 0);
});
