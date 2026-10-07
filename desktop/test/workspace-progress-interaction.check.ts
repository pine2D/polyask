import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';
import { buildSync } from 'esbuild';

test('native page summaries and saved reading preserve positive native view bounds at both densities and zoom', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-run-progress-'));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/workspace-progress-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  buildSync({ entryPoints: [join(__dirname, '../src/main/workspace-layout.ts')], bundle: true, platform: 'node',
    format: 'cjs', outfile: join(output, 'layout.cjs') });
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; connect-src \'none\'"><div id="root"></div><script src="bundle.js"></script>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/workspace-progress-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  console.log(`Progress evidence: ${output}`); assert.equal(result.status, 0, `${result.stderr}\n${result.error?.message ?? ''}`);
});
