import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import webpack from 'webpack';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function inputManifest(): Record<string, string> {
  const base = join(__dirname, '..'), files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(base, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path); else if (entry.isFile()) files[path] = digest(join(base, path));
    }
  };
  visit('src');
  for (const file of ['package.json', 'package-lock.json', 'test/preferences-drafts-native.check.ts',
    'scripts/preferences-drafts-native.mjs', ...readdirSync(join(base, 'test/ui')).filter(name => name.startsWith('preferences-drafts-native-')).map(name => `test/ui/${name}`)]) {
    files[file] = digest(join(base, file));
  }
  return files;
}

test('isolated production preferences and draft editors survive native input, cloud pushes and process restart', { timeout: 360000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-preferences-drafts-native-'));
  const inputs = inputManifest();
  writeFileSync(join(output, 'empty-preload.cjs'), '');
  for (const [entry, name, target] of [
    ['src/renderer/index.tsx', 'bundle.js', 'web'],
    ['src/preload/shell.ts', 'preload.cjs', 'electron-preload'],
    ['src/main/view-manager.ts', 'manager.cjs', 'electron-main'],
    ['test/ui/preferences-drafts-native-services.ts', 'services.cjs', 'electron-main']
  ] as const) await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '..'), devtool: false, target,
      entry: join(__dirname, '..', entry), output: { path: output, filename: name,
        ...(target === 'electron-main' ? { library: { type: 'commonjs2' } } : {}) },
      resolve: { extensions: ['.tsx', '.ts', '.js'] },
      plugins: [new webpack.DefinePlugin({ SITE_WINDOW_PRELOAD_WEBPACK_ENTRY: JSON.stringify(join(output, 'empty-preload.cjs')) })],
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] }] }
    });
    compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors()
      ? reject(error || Error(stats?.toString({ all: false, errors: true }))) : resolve()));
  });
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ inputs,
    artifacts: Object.fromEntries(['bundle.js', 'preload.cjs', 'manager.cjs', 'services.cjs', 'index.html'].map(name => [name, digest(join(output, name))])) }, null, 2));
  const binary = require('electron') as string;
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    mkdirSync(join(output, locale));
    for (const phase of ['write', 'read']) {
      const result = spawnSync(binary, [join(__dirname, 'ui/preferences-drafts-native-runtime.cjs'), output, locale, phase],
        { encoding: 'utf8', timeout: 55000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '' } });
      console.log(`Preferences/drafts native ${locale} ${phase}: ${output}\n${result.stdout}`);
      assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
    }
  }
  assert.deepEqual(inputManifest(), inputs, 'production sources and native harness must stay frozen throughout artifact validation');
});
