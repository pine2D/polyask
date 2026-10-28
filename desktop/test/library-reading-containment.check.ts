import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import webpack from 'webpack';

test('offscreen long answers defer layout while source jumps, find, and reading positions remain usable', { timeout: 60000 }, async () => {
  const root = join(__dirname, '..'), output = mkdtempSync(join(tmpdir(), 'polyask-reading-containment-'));
  const { runOwnedNative } = await import(pathToFileURL(join(root, 'scripts/lib/owned-native-process.mjs')).href);
  const prepare = async () => {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'production', optimization: { minimize: false }, context: root, devtool: false,
        entry: join(__dirname, 'ui/library-reading-performance-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ] } });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
        ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  };
  await runOwnedNative({ command: 'xvfb-run', args: ['-a', '-s', '-screen 0 1920x1200x24', require('electron'),
    join(__dirname, 'ui/library-reading-containment-runtime.cjs'), output], cwd: root, output, timeout: 50000,
    beforeSpawn: prepare, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(output, 'no-session-bus') },
    onStdout: (chunk: string) => process.stdout.write(chunk), cleanupPaths: () => [join(output, 'profile')] });
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.cases.length, 6); assert.equal(report.requests, 0);
});
