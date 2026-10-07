import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, loadavg, cpus, totalmem } from 'node:os';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

const sources = ['renderer/folder-workspace.tsx', 'renderer/library-content-list.tsx', 'renderer/library-list-model.ts',
  'renderer/archive-surface.tsx', 'renderer/archive-detail.tsx', 'renderer/archive-compare.tsx',
  'renderer/archive-reader-session.ts', 'renderer/markdown-preview.tsx', 'renderer/markdown-parser.ts',
  'renderer/markdown-math-tokens.ts', 'shared/archive.ts', 'shared/decision.ts', 'shared/archive-compare.ts'];
const manifest = () => Object.fromEntries(sources.map(path => [path,
  createHash('sha256').update(readFileSync(join(__dirname, '../src', path))).digest('hex')]));

test('finite U32 post measurement retains one thousand mixed records and two complete nine-answer long sources', { timeout: 120000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-u32-post-')), before = manifest();
  writeFileSync(join(output, 'source-manifest.json'), JSON.stringify({ before, environment: {
    loadAverage: loadavg(), logicalCpus: cpus().length, cpuModel: cpus()[0]?.model ?? '', memoryBytes: totalmem(),
    workload: 'new analogous finite synthetic data; original pre-measurement source is unavailable' } }));
  await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'production', optimization: { minimize: false }, context: join(__dirname, '..'), devtool: false,
      entry: join(__dirname, 'ui/library-reading-performance-fixture.tsx'), output: { path: output, filename: 'bundle.js', publicPath: './' },
      resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
        { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; base-uri \'self\'; form-action \'self\'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
  const binary = require('electron') as string, args = [join(__dirname, 'ui/library-reading-performance-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', '-s', '-screen 0 1920x1200x24', binary, ...args] : args,
    { encoding: 'utf8', timeout: 90000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (result.stdout) process.stdout.write(result.stdout);
  const after = manifest();
  writeFileSync(join(output, 'post-source-manifest.json'), JSON.stringify({ after, loadAverage: loadavg() }));
  for (const path of sources) assert.equal(after[path], before[path], `measured production source stayed fixed: ${path}`);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')) as {
    ok: boolean; requests: number; samples: { scenario: string; parseDelta: number; rows: number; hiddenReading: number }[];
    summary: { scenario: string; n: number }[]; targets: { scenario: string; p95TargetMs: number; met: boolean }[];
    snapshots: { surface: string; jsHeapBytes: number; rendererResidentKiB: number }[];
    workload: { total: number; archives: number; decisions: number; longRecords: number; answersPerRecord: number; longBytes: number[] };
    environment: { viewport: { width: number; height: number }; zoom: number };
  };
  assert.equal(report.ok, true); assert.equal(report.requests, 0); assert.equal(report.samples.length, 160);
  assert.equal(report.workload.total, 1000); assert.equal(report.workload.archives, 500); assert.equal(report.workload.decisions, 500);
  assert.equal(report.workload.longRecords, 2); assert.equal(report.workload.answersPerRecord, 9); assert.equal(report.workload.longBytes.length, 18);
  assert.equal(report.workload.longBytes.every(value => value >= 31 * 1024 && value <= 32 * 1024), true);
  assert.equal(report.environment.viewport.width, 1600); assert.equal(report.environment.viewport.height, 1000); assert.equal(report.environment.zoom, 1);
  for (const scenario of ['list-mount', 'search-narrow', 'search-broad', 'nine-long-open', 'nine-long-switch', 'read-to-compare', 'compare-parent-redraw', 'compare-to-read']) {
    assert.equal(report.summary.filter(row => row.scenario === scenario && row.n === 20).length, 1);
    assert.equal(report.samples.filter(row => row.scenario === scenario).length, 20);
  }
  assert.equal(report.samples.every(sample => sample.rows <= 100 && sample.hiddenReading === 0), true);
  assert.equal(report.samples.filter(sample => sample.scenario === 'compare-parent-redraw').every(sample => sample.parseDelta === 0), true);
  assert.equal(report.snapshots.length, 2);
  assert.equal(report.snapshots.every(snapshot => snapshot.jsHeapBytes > 0 && snapshot.rendererResidentKiB > 0), true);
  // Retain engineering targets verbatim; report unmet targets without inventing a paired ratio.
  for (const [scenario, target] of Object.entries({ 'list-mount': 150, 'search-broad': 350, 'nine-long-open': 450,
    'nine-long-switch': 350, 'read-to-compare': 250, 'compare-parent-redraw': 80 })) {
    assert.equal(report.targets.find(row => row.scenario === scenario)?.p95TargetMs, target);
  }
});
