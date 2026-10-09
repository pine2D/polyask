import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('Chromium renders local Mermaid and exercises history reading controls', { timeout: 120000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-reading-ui-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
        entry: join(__dirname, 'ui/reading-fixture.tsx'), output: { path: output, filename: 'bundle.js', publicPath: './' },
        resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
    const binary = require('electron') as string, args = [join(__dirname, 'ui/reading-runtime.cjs'), output];
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
      { encoding: 'utf8', timeout: 80000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    console.log(result.stdout);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
