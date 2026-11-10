import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('Claude presets support native interaction, locales, themes, narrow layout and zoom', { timeout: 110000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-tier-presets-native-'));
  console.log(`Claude presets native evidence: ${output}`);
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/tier-presets-native-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/tier-presets-native-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 90000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  if (existsSync(join(output, 'process-boundary.json'))) {
    const boundary = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8'));
    const alive = boundary.observed.filter((pid: number) => existsSync(`/proc/${pid}`));
    assert.equal(alive.length, 0, 'all observed isolated Electron processes exit');
  }
  rmSync(join(output, 'profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(result.status, 0, `Native Claude presets failed: ${output}; ${result.error?.message ?? ''}`);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.cases.length, 13); assert.equal(report.network, 0);
  assert.equal(report.errors.length, 0);
});
