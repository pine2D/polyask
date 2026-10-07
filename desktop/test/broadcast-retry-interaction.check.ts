import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('retry review uses native input and preserves manual resend boundaries in three languages', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-broadcast-retry-'));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/broadcast-retry-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/broadcast-retry-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 70000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  console.log(`Broadcast retry artifacts: ${output}`);
  console.log(result.stdout);
  assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.deepEqual(report, ['en', 'zh-CN', 'zh-TW'].flatMap(locale => [1200, 640].map(width => ({ locale, width, ok: true }))));
});
