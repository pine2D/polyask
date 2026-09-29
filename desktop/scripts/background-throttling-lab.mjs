// Isolated mechanism experiment, not a nine-site compatibility test.
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const output = await mkdtemp(join(tmpdir(), 'polyask-throttling-lab-'));
const child = spawn(require('electron'), [join(dirname(fileURLToPath(import.meta.url)), 'background-throttling-runtime.cjs'), output],
  { stdio: 'inherit' });
// This child owns only disposable offline data; enforce the limit even if its
// event loop is stuck and cannot handle a graceful termination.
const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); }); }
finally { clearTimeout(timer); }
console.log(`Background throttling evidence: ${output}`);
if (code !== 0) process.exitCode = 1;
else {
  const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
  assert.deepEqual(report.phases.map(phase => phase.name), ['baseline', 'all-throttled', 'mixed', 'restored']);
}
