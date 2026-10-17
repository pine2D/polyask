import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('native library cancellation and failed saves retain reading and keyboard context', { timeout: 60000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-library-recovery-'));
  console.log(`Library recovery evidence: ${output}`);
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/library-recovery-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\';style-src \'self\' \'unsafe-inline\';script-src \'self\';img-src data:;connect-src \'none\'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/library-recovery-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 50000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      ...(process.platform === 'linux' ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } : {}) } });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  if (result.stdout) process.stdout.write(result.stdout);
  if (process.platform === 'linux' && existsSync(join(output, 'process-boundary.json'))) {
    const resource = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')) as { observed: number[] };
    for (let round = 0; round < 20 && resource.observed.some(pid => existsSync(`/proc/${pid}`)); round++) await new Promise(resolve => setTimeout(resolve, 50));
    const remaining = resource.observed.filter(pid => existsSync(`/proc/${pid}`));
    writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ remainingObservedPids: remaining }, null, 2));
    assert.equal(remaining.length, 0, 'native owned processes exit');
  }
  rmSync(join(output, 'profile'), { recursive: true, force: true });
  assert.equal(result.status, 0, `Native recovery failed. Evidence: ${output}; ${result.error?.message || ''}`);
  const data = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as { report: { ok: boolean }[]; geometry: unknown[] };
  assert.equal(data.report.length, 37); assert.equal(data.report.every(item => item.ok), true); assert.equal(data.geometry.length, 30);
});
