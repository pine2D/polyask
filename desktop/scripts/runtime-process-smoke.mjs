// Real Electron bridge and production monitoring; offline disposable profile.
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'polyask-runtime-process-'));
await require('esbuild').build({
  stdin: { contents: 'export * from "./src/main/runtime-gates"; export * from "./src/main/site-health-ipc"; export * from "./src/main/runtime-process-diagnostics"; export * from "./src/shared/site-report";', resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(output, 'production.cjs')
});
await require('esbuild').build({ entryPoints: [join(root, 'src/preload/shell.ts')], bundle: true,
  platform: 'node', format: 'cjs', external: ['electron'], outfile: join(output, 'preload.cjs') });
await writeFile(join(output, 'shell.html'), '<!doctype html><title>Offline process diagnostics check</title>');
const child = spawn(require('electron'), [join(root, 'scripts/runtime-process-runtime.cjs'), output], { stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
try {
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  if (code !== 0) process.exitCode = 1;
} finally { clearTimeout(timer); }
console.log(`Runtime process evidence: ${output}`);
