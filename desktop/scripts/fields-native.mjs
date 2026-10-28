// Isolated CSS acceptance with bounded native processes and generated, disposable profiles.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url), webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cssImports = path => [...readFileSync(path, 'utf8').matchAll(/import\s+["']([^"']+\.css)["']/g)].map(match => match[1].split('/').at(-1));
assert.equal(cssImports(join(root, 'test/ui/fields-native-fixture.ts')).join('|'), cssImports(join(root, 'src/renderer/index.tsx')).join('|'), 'fixture loads production global styles in order');
const output = mkdtempSync(join(tmpdir(), 'polyask-fields-native-'));
console.log(`Native input boundary evidence: ${output}`);
const boundaryOutput = join(output, 'launcher-boundary'); mkdirSync(boundaryOutput);
const sample = require('../test/ui/native-process-boundary.cjs').processBoundary({ getAppMetrics: () => [] }, boundaryOutput);
const prepare = async () => {
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'production', context: root, devtool: false,
      entry: join(root, 'test/ui/fields-native-fixture.ts'), output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.ts', '.js'] }, module: { rules: [
        { test: /\.ts$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }
      ] } });
    compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
      ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);
};
const result = await runOwnedNative({ command: 'xvfb-run',
  args: ['-a', '-s', '-screen 0 1920x1400x24', require('electron'), join(root, 'test/ui/fields-native-runtime.cjs'), output],
  cwd: root, output, beforeSpawn: prepare, onSample: sample,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '', DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` },
  onStdout: chunk => process.stdout.write(chunk), cleanupPaths: () => [join(output, 'profile')]
});
console.log(`Native input boundary acceptance passed; profile removed; ${result.observed.length} owned processes exited`);
