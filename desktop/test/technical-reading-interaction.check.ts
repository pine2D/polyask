import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('six native locale and width combinations preserve code and render safe local Worker MathML', { timeout: 120000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-technical-reading-'));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/technical-reading-fixture.tsx'), output: { path: output, filename: 'bundle.js', publicPath: './' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; base-uri \'self\'; form-action \'self\'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/technical-reading-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 100000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (result.stdout) process.stdout.write(result.stdout);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  const data = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
    report: { locale: string; width: number; ok: boolean; systemClipboardExact?: boolean; workerMathml?: boolean }[]; requests: number;
  };
  assert.equal(data.report.length, 6);
  for (const locale of ['en', 'zh-CN', 'zh-TW']) for (const width of [1200, 640]) {
    const rows = data.report.filter(row => row.locale === locale && row.width === width);
    assert.equal(rows.length, 1); assert.equal(rows[0].ok, true);
    assert.equal(rows[0].systemClipboardExact, true); assert.equal(rows[0].workerMathml, true);
  }
  assert.equal(data.requests, 0);
});
