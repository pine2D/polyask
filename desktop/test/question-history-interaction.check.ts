import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';
test('history ignores departed detail requests and refreshes every loaded page without starving slow reads', { timeout: 90000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-history-ui-'));
  const root = join(__dirname, '..');
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: root, devtool: false,
        entry: join(__dirname, 'ui/question-history-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>');
    const binary = require('electron') as string;
    const args = [join(__dirname, 'ui/question-history-runtime.cjs'), output];
    const linuxHeadless = process.platform === 'linux' && !process.env.DISPLAY;
    const result = spawnSync(linuxHeadless ? 'xvfb-run' : binary, linuxHeadless ? ['-a', binary, ...args] : args,
      { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
