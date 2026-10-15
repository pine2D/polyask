import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('native library tools anchor pointer motion and keep keyboard and reduced-motion paths immediate', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-library-motion-'));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'production', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/library-motion-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src \'none\'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/library-motion-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (result.stdout) process.stdout.write(result.stdout);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
    ok: boolean; requests: number; matrix: { kind: string; locale: string; theme: string; placement: string }[];
    interaction: { kind: string; keyboard: boolean; reduced: boolean; interrupt: boolean; immediateClose: boolean; assistive: boolean }[];
  };
  assert.equal(report.ok, true); assert.equal(report.requests, 0); assert.equal(report.matrix.length, 26);
  assert.equal(report.interaction.length, 2);
  assert.equal(report.interaction.every(row => row.keyboard && row.reduced && row.interrupt && row.immediateClose && row.assistive), true);
});
