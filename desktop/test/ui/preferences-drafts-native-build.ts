import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import webpack from 'webpack';

export async function buildPreferencesShell(output: string): Promise<void> {
  writeFileSync(join(output, 'empty-preload.cjs'), '');
  for (const [entry, name, target] of [
    ['src/renderer/index.tsx', 'bundle.js', 'web'],
    ['src/preload/shell.ts', 'preload.cjs', 'electron-preload'],
    ['src/main/view-manager.ts', 'manager.cjs', 'electron-main'],
    ['test/ui/preferences-drafts-native-services.ts', 'services.cjs', 'electron-main']
  ] as const) await new Promise<void>((resolve, reject) => {
    const compiler = webpack({ mode: 'development', context: join(__dirname, '../..'), devtool: false, target,
      entry: join(__dirname, '../..', entry), output: { path: output, filename: name,
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
}

export function runPreferencesShell(output: string, locale: string, phase: 'themes' | 'write' | 'read'): void {
  const result = spawnSync(require('electron') as string, [join(__dirname, 'preferences-drafts-native-runtime.cjs'), output, locale, phase], {
    encoding: 'utf8', timeout: phase === 'themes' ? 150000 : 60000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` }
  });
  console.log(`Preferences/drafts native ${locale} ${phase}: ${output}\n${result.stdout}`);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const report = phase === 'themes' ? 'theme-matrix.json' : `${locale}-${phase}.json`;
  assert.equal(existsSync(join(output, report)), true, 'completed native phase must write ' + report);
}
