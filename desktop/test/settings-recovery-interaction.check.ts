import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('settings and recovery use native input for counts, disclosure, display and safe manual advice', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-settings-recovery-'));
  const root = join(__dirname, '..');
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: root, devtool: false,
      entry: join(__dirname, 'ui/settings-recovery-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string;
  const args = [join(__dirname, 'ui/settings-recovery-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', '-s', '-screen 0 1920x1200x24', binary, ...args] : args,
    { encoding: 'utf8', timeout: 70000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  console.log(`Settings recovery artifacts: ${output}`);
  console.log(result.stdout);
  assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as { locale: string; width: number; ok: boolean }[];
  assert.equal(report.length, 6, 'all locale/width combinations must complete');
  for (const locale of ['zh-CN', 'zh-TW', 'en']) for (const width of [1200, 640]) {
    const results = report.filter(item => item.locale === locale && item.width === width);
    assert.equal(results.length, 1, `exactly one ${locale}/${width} result`);
    assert.equal(results[0].ok, true, `${locale}/${width} native result`);
  }
});
