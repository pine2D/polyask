import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('saved history copies preserve reader state and enter existing results and folders in native UI', async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-history-library-ui-'));
  const root = join(__dirname, '..');
  console.log(`History/library evidence: ${output}`);
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: root, devtool: false,
      entry: join(__dirname, 'ui/history-to-library-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string;
  const args = [join(__dirname, 'ui/history-to-library-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 45000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
  assert.equal(result.status, 0, `History/library native regression failed. Evidence: ${output}; ${result.error?.message || ''}`);
  const reports = result.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const names = reports.map(report => report.scenario).sort().join(',');
  assert.equal(names, ['three-locales-two-themes-widths-and-zoom', 'reader-scroll-evidence',
    'old-copy-read-compare-and-existing-folder', 'late-replies-and-full-reask'].sort().join(','), 'every native scenario must report');
  assert.equal(reports.every(report => report.ok === true), true);
  const geometry = JSON.parse(readFileSync(join(output, 'geometry.json'), 'utf8'));
  assert.equal(geometry.length, 24, 'all locale/theme/width/zoom combinations must complete');
  assert.equal(new Set(geometry.map((entry: { name: string }) => entry.name)).size, 24);
  const copied = JSON.parse(readFileSync(join(output, 'clipboard.json'), 'utf8'));
  assert.equal(copied.length, 25, 'each matrix case and the final reask must copy the full original');
  assert.equal(copied.every((entry: { exact: boolean; systemReadType: string; selection: string }) =>
    entry.exact && entry.systemReadType === 'string' && entry.selection === 'system'), true);
});
