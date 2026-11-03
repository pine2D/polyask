import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedNative } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url), webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url))), output = mkdtempSync(join(tmpdir(), 'polyask-reading-experience-'));
console.log('Reading experience evidence: ' + output);
const prepare = () => new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', optimization: { minimize: false }, context: root, devtool: false,
    entry: join(root, 'test/ui/reading-experience-fixture.tsx'), output: { path: output, filename: 'bundle.js', publicPath: './' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] }, module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ] } });
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors()
    ? reject(error || Error(stats.toString({ all: false, errors: true }))) : resolve()));
  writeFileSync(join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="bundle.js"></script>');
});
await runOwnedNative({ command: 'xvfb-run', args: ['-a', '-s', '-screen 0 1920x1200x24', require('electron'),
  join(root, 'test/ui/reading-experience-runtime.cjs'), output, ...process.argv.slice(2)], cwd: root, output, timeout: 180000, beforeSpawn: prepare,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '', DBUS_SESSION_BUS_ADDRESS: 'unix:path=' + join(output, 'no-session-bus') },
  onStdout: chunk => process.stdout.write(chunk), cleanupPaths: () => [join(output, 'profile')] });
const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
if (report.failures.length || report.network || report.errors.length) throw Error('Reading experience checks failed: ' + output);
console.log(`${report.cases.length} reading layouts verified; owned processes exited and temporary profile removed.`);
