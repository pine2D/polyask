import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

export async function checkNativeReading(suite: 'comparison' | 'analysis', expectedScenarios: readonly string[]) {
  const output = mkdtempSync(join(tmpdir(), `polyask-${suite}-reading-`));
  console.log(`${suite} native evidence: ${output}`);
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '../..'), devtool: false,
      entry: join(__dirname, 'reading-analysis-fixture.tsx'), output: { path: output, filename: 'bundle.js', publicPath: './' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'reading-native-runtime.cjs'), output, suite];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 45000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  if (result.stdout) process.stdout.write(result.stdout);
  assert.equal(result.status, 0, `Native reading failed. Evidence: ${output}; ${result.error?.message || ''}`);
  const data = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
    report: { scenario: string; ok: boolean }[]; geometry: { name: string; overflow: boolean; controlOverflow: boolean }[];
    clipboard: { exact: boolean; sourceBodiesExact: boolean; selection: string }[];
  };
  assert.equal(data.report.map(item => item.scenario).sort().join(','), [...expectedScenarios].sort().join(','));
  assert.equal(data.report.every(item => item.ok), true);
  assert.equal(data.geometry.length, 14); assert.equal(new Set(data.geometry.map(item => item.name)).size, 14);
  const expected = ['en', 'zh-CN', 'zh-TW'].flatMap(locale => ['light', 'dark'].flatMap(theme =>
    [1200, 640].map(width => `${locale}-${theme}-${width}-100-normal`)));
  expected.push('en-light-960-150-normal', 'zh-TW-light-1200-100-forced');
  assert.equal(data.geometry.map(item => item.name).sort().join(','), expected.sort().join(','));
  assert.equal(data.geometry.every(item => !item.overflow && !item.controlOverflow), true);
  if (suite === 'analysis') {
    assert.equal(data.clipboard.length, 14);
    assert.equal(data.clipboard.every(item => item.exact && item.sourceBodiesExact && item.selection === 'system'), true);
  }
}
