// Isolated production-component render: no user profile or network access.
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const webpack = require('webpack');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'polyask-shell-ui-'));
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: 'production', context: root, devtool: false,
    entry: join(root, 'test/ui/shell-fixture.tsx'), output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    module: { rules: [
      { test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader: 'ts-loader', options: { transpileOnly: true } }] },
      { test: /\.css$/, use: ['style-loader', 'css-loader'] }
    ] }
  });
  compiler.run((error, stats) => compiler.close(() => error || stats.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
});
await writeFile(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; script-src \'self\'; img-src data:; connect-src \'none\'"><title>PolyAsk synthetic shell fixture</title></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '', WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` };
const child = spawn(require('electron'), [join(root, 'scripts/shell-visual-runtime.cjs'), output, ...process.argv.slice(2)], { stdio: 'inherit', env });
// Includes all seven settings categories across locale, density, theme and zoom; allow software rendering.
const timer = setTimeout(() => child.kill('SIGTERM'), 420_000);
const status = await new Promise(resolve => child.on('exit', resolve));
clearTimeout(timer);
if (process.platform === 'linux') {
  let boundary;
  try { boundary = JSON.parse(await readFile(join(output, 'process-boundary.json'), 'utf8')); }
  catch (error) { if (status === 0 || error.code !== 'ENOENT') throw error; }
  const live = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let round = 0; round < 20 && boundary?.observed.some(live); round++) await new Promise(resolve => setTimeout(resolve, 50));
  await writeFile(join(output, 'cleanup.json'), JSON.stringify({ remainingObservedPids: (boundary?.observed ?? []).filter(live) }));
  for (const pid of boundary?.observed ?? []) {
    let live = false; try { process.kill(pid, 0); live = true; } catch { /* expected after Electron exit */ }
    if (live) throw Error(`Native settings process ${pid} did not exit`);
  }
  if (boundary) await rm(join(output, 'profile'), { recursive: true, force: true });
}
console.log(`Shell UI report and screenshots: ${output}`);
if (status !== 0) process.exitCode = 1;
