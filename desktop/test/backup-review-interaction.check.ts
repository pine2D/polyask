import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

test('large backups preserve visible batch scope, named dependencies and final confirmation in three languages', { timeout: 120000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-backup-review-'));
  const artifacts = process.env.POLYASK_BACKUP_REVIEW_ARTIFACTS ?? join(output, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false,
        entry: join(__dirname, 'ui/backup-review-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
        resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
          { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ] }
      });
      compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats?.toString({ all: false, errors: true }))) : resolve()));
    });
    writeFileSync(join(output, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
    const binary = require('electron') as string, args = [join(__dirname, 'ui/backup-review-runtime.cjs'), output, artifacts];
    const headless = process.platform === 'linux' && !process.env.DISPLAY;
    const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
      { encoding: 'utf8', timeout: 100000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    process.stdout.write(result.stdout);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
