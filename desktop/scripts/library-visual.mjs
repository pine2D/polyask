// Isolated Electron UI regression: no user profile, network calls or business data.
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'polyask-library-ui-'));
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', context: root, devtool: false,
    entry: join(root, 'test/ui/library-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ] }
  });
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
});
await writeFile(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; script-src \'self\'; img-src \'none\'; connect-src \'none\'"><title>Result library UI test</title></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
const child = spawn(require('electron'), [join(root, 'scripts/library-visual-runtime.cjs'), output], { stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
const status = await new Promise(resolve => child.on('exit', resolve));
clearTimeout(timer);
console.log(`UI report and screenshots: ${output}`);
if (status !== 0) process.exitCode = 1;
