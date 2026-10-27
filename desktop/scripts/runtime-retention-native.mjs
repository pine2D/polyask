import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';

const require = createRequire(import.meta.url), webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'polyask-runtime-retention-'));
console.log(`Runtime retention evidence: ${output}`);
const boundaryOutput = join(output, 'launcher-boundary');
mkdirSync(boundaryOutput);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const sample = processBoundary({ getAppMetrics: () => [] }, boundaryOutput);
// Bundle the actual preload and its complete runtime chain, preserving isolation.
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'development', context: root, target: 'electron-preload', devtool: false,
    entry: join(root, 'src/preload/site.ts'), output: { path: output, filename: 'site-preload.cjs' },
    resolve: { extensions: ['.ts', '.js'] },
    module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] }] }
  });
  compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
    ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
});
const result = await runOwnedNative({
  command: 'xvfb-run', args: ['-a', require('electron'), join(root, 'test/ui/runtime-retention-native.cjs'), output],
  cwd: root, output, timeout: 90000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` },
  onSample: sample, onStdout: chunk => process.stdout.write(chunk), cleanupPaths: () => [join(output, 'profile')]
});
const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
assert.equal(report.scenarios.length, 6, 'all lifecycle cases must finish before the app exits');
assert.equal(report.scenarios.every(item => item.retained === 0), true);
assert.equal(report.destroyed, 3);
console.log(`Runtime retention native checks passed; ${result.observed.length} owned processes exited`);
