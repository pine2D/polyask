import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import webpack from 'webpack';

test('native Electron keeps selected views alive through hidden navigation and cleans up recreated windows', { timeout: 180000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-electron-lifecycle-'));
  let passed = false;
  try {
    writeFileSync(join(output, 'empty-preload.cjs'), '');
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), target: 'electron-main', devtool: false,
        entry: join(__dirname, 'ui/electron-lifecycle-services.ts'),
        output: { path: output, filename: 'services.cjs', library: { type: 'commonjs2' } },
        resolve: { extensions: ['.ts', '.js'] },
        plugins: [new webpack.DefinePlugin({ SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(join(output, 'empty-preload.cjs')) })],
        module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] }] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
        ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    const binary = require('electron') as string;
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    const args = [join(__dirname, 'ui/electron-lifecycle-runtime.cjs'), output];
    const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args, {
      timeout: 100000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '',
        WAYLAND_SOCKET: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-polyask-lifecycle-bus' }
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(report.cycles, 2);
    assert.equal(report.sites, 9);
    assert.equal(report.destroyed, 18);
    if (process.platform === 'linux') {
      const boundary = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8'));
      assert.equal(boundary.samples.length >= 4, true);
      for (const pid of boundary.observed) {
        let live = false;
        try { process.kill(pid, 0); live = true; } catch { /* expected after native app exit */ }
        assert.equal(live, false, `native process ${pid} exited`);
      }
    }
    console.log(`Electron lifecycle passed: ${JSON.stringify(report)}`);
    passed = true;
  } finally {
    if (passed) rmSync(output, { recursive: true, force: true });
    else console.log(`Electron lifecycle evidence retained: ${output}`);
  }
});
