import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('guide native UI covers three locales at two widths with explicit local and saved-read actions', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-guide-native-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
        entry: join(__dirname, 'ui/workbench-guide-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ] } });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
        ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
    const binary = require('electron') as string, args = [join(__dirname, 'ui/workbench-guide-runtime.cjs'), output];
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
      { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
