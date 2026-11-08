// Offline, bounded real database/IPC + native-page baselines. Always launch through test-safe.mjs.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, platform, release, cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runOwnedNative } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url), webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const option = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const sizes = option('sizes', '1000,5000,20000').split(',').map(Number), repeats = Number(option('repeats', '10'));
if (!sizes.every(n => [1000, 5000, 20000].includes(n)) || !Number.isInteger(repeats) || repeats < 3 || repeats > 30) throw Error('invalid_bounded_workload');
const output = mkdtempSync(join(tmpdir(), 'polyask-resource-baseline-'));
console.log(`Resource baseline evidence: ${output}`);
const launcher = join(output, 'launcher'); mkdirSync(launcher);
const boundary = require('../test/ui/native-process-boundary.cjs').processBoundary({ getAppMetrics: () => [] }, launcher);
boundary();
const report = { timestamp: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  displayBackend: process.argv.includes('--host-display') ? 'existing DISPLAY (pages only)' : 'private Xvfb',
  platform: platform(), release: release(), cpus: cpus().length, loadBefore: loadavg(), repeats, sizes,
  percentiles: 'nearest-rank ceil(p*n); warm samples only; first-query and 2 warmups excluded', runs: [] };
const started = Date.now(), fullDeadline = started + 420000;
const build = join(output, 'build'); mkdirSync(build);
writeFileSync(join(build, 'empty-preload.cjs'), '');
const compiler = webpack({ mode: 'development', context: root, devtool: false, target: 'electron-main',
  entry: join(root, 'test/ui/resource-baseline-services.ts'), output: { path: build, filename: 'services.cjs', library: { type: 'commonjs2' } },
  plugins: [new webpack.DefinePlugin({ SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(join(build, 'empty-preload.cjs')) })],
  resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] } ] } });
const compileTimer = setTimeout(() => { console.error('baseline_build_timeout'); process.exit(1); }, 45000);
try { await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() =>
  error || stats.hasErrors() ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()))); }
finally { clearTimeout(compileTimer); }
report.hashes = Object.fromEntries(['src/main/task-folder-query.ts', 'test/ui/resource-baseline-data.cjs', 'test/ui/resource-baseline-db.cjs', 'test/ui/resource-baseline-consumer.js', 'test/ui/resource-baseline-pages.cjs'].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
report.bundleSha256 = createHash('sha256').update(readFileSync(join(build, 'services.cjs'))).digest('hex');
copyFileSync(join(root, 'test/ui/resource-baseline-preload.cjs'), join(build, 'preload.cjs'));
copyFileSync(join(root, 'test/ui/resource-baseline-consumer.js'), join(build, 'consumer.js'));
writeFileSync(join(build, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'"><ul></ul><script src="consumer.js"></script>');
const save = () => writeFileSync(join(output, 'report.json'), JSON.stringify({ ...report, elapsedMs: Date.now() - started, loadAfter: loadavg() }, null, 2));
for (const mode of [...(process.argv.includes('--pages-only') ? [] : sizes.map(String)), ...(process.argv.includes('--db-only') ? [] : ['pages'])]) {
  const directory = join(output, mode); mkdirSync(directory);
  const timeout = Math.min(mode === 'pages' ? 90000 : 95000, fullDeadline - Date.now());
  if (timeout <= 0) throw Error('whole_run_deadline');
  let censored = null;
  try {
    const direct = mode === 'pages' && process.argv.includes('--host-display');
    await runOwnedNative({ command: direct ? require('electron') : 'xvfb-run', args: [...(direct ? [] : ['-a', '-s', '-screen 0 1920x1200x24', require('electron')]),
      join(root, `test/ui/resource-baseline-${mode === 'pages' ? 'pages' : 'db'}.cjs`), directory, build, mode, String(repeats)],
      cwd: root, output: directory, timeout, onSample: boundary, onStdout: chunk => process.stdout.write(chunk),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '', DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(directory, 'no-session-bus')}` },
      cleanupPaths: () => [join(directory, 'profile'), join(directory, 'synthetic-data')] });
  } catch (error) {
    if (!String(error).includes('owned_native_timeout:')) throw error;
    censored = { reason: 'outer_process_timeout', timeoutMs: timeout, inFlight: JSON.parse(readFileSync(join(directory, 'in-flight.json'), 'utf8')) };
  }
  const cleanup = JSON.parse(readFileSync(join(directory, 'cleanup.json'), 'utf8'));
  assert.equal(cleanup.live.length + cleanup.errors.length + cleanup.cleanupErrors.length, 0);
  assert.equal(cleanup.paths.every(path => !path.exists), true);
  report.runs.push({ mode, directory, censored, result: JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')) }); save();
}
console.log(`Resource baseline finished; evidence: ${output}`);
