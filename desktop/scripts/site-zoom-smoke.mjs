// Exercise production zoom code with real Electron input and synthetic offline pages.
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = await mkdtemp(join(tmpdir(), 'polyask-site-zoom-'));
await require('esbuild').build({
  stdin: { contents: 'export * from "./src/main/site-zoom"; export * from "./src/main/ui-state-store"; export * from "./src/main/workspace-layout"; export * from "./src/shared/display";', resolveDir: root },
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: join(output, 'production.cjs')
});
await writeFile(join(output, 'shell.html'), '<!doctype html><title>Offline site zoom check</title><p>Shell zoom stays unchanged</p>');
const child = spawn(require('electron'), [join(root, 'scripts/site-zoom-runtime.cjs'), output], { stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
const status = await new Promise(resolve => child.on('exit', resolve));
clearTimeout(timer);
console.log(`Site zoom evidence: ${output}`);
if (status !== 0) process.exitCode = 1;
