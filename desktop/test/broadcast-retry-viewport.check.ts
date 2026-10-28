import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpack from 'webpack';

test('retry review keeps actions visible and all nine choices keyboard reachable at short and zoomed viewports', { timeout: 180000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-retry-viewport-'));
  console.log(`Retry viewport evidence: ${output}`);
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/broadcast-retry-viewport-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const { runOwnedNative } = require('../scripts/lib/owned-native-process.mjs');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/broadcast-retry-viewport-runtime.cjs'), output];
  const headless = process.platform === 'linux';
  const result = await runOwnedNative({ command: headless ? 'xvfb-run' : binary,
    args: headless ? ['-a', '-s', '-screen 0 1920x1200x24', binary, ...args] : args,
    cwd: join(__dirname, '..'), output, timeout: 140000, onStdout: (chunk: string) => process.stdout.write(chunk),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
      ...(process.platform === 'linux' ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } : {}) },
    cleanupPaths: () => [join(output, 'profile')] });
  assert.equal(result.live.length, 0); assert.equal(result.errors.length, 0);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.cases.length, 36); assert.equal(report.errors.length, 0); assert.equal(report.network, 0);
});
