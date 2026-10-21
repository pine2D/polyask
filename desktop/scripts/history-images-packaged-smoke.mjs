// Actual packaged main/preload smoke, isolated from DNS/network and sampled across all child threads.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'polyask-history-images-smoke-'));
console.log(`Packaged smoke evidence: ${output}`);
const boundary = processBoundary({ getAppMetrics: () => [] }, output);
const child = spawn('xvfb-run', ['-a', process.execPath, join(root, 'scripts/smoke.mjs'), '--skip-package', '--offline'], {
  cwd: root, env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '', boundaryError;
const profiles = new Set(), offlineProcesses = new Set();
child.stdout.on('data', chunk => { log += String(chunk); process.stdout.write(chunk); });
child.stderr.on('data', chunk => { log += String(chunk); });
const sample = () => { try {
  boundary();
  const latest = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')).samples.at(-1);
  for (const { pid } of latest.processes) {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const profile = args.find(value => value.startsWith('--user-data-dir='))?.slice(16);
      if (profile?.includes('/polyask-smoke-')) profiles.add(profile);
      if (args.includes('--host-resolver-rules=MAP * ~NOTFOUND')) offlineProcesses.add(pid);
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  }
} catch (error) { boundaryError = error; child.kill('SIGTERM'); } };
sample(); const timer = setInterval(sample, 20);
const code = await new Promise(resolve => child.on('exit', resolve));
clearInterval(timer); sample();
writeFileSync(join(output, 'runtime.log'), log);
const { observed } = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8'));
const end = Date.now() + 3000;
let live;
do { live = observed.filter(pid => pid !== process.pid && existsSync(`/proc/${pid}`)); if (live.length) await new Promise(resolve => setTimeout(resolve, 30)); } while (live.length && Date.now() < end);
writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ observed, live, profiles: [...profiles].map(path => ({ path, exists: existsSync(path) })), offlineProcesses: [...offlineProcesses] }, null, 2));
assert.equal(boundaryError === undefined, true, boundaryError?.message);
assert.equal(code, 0, log.slice(-2000));
assert.equal(live.length, 0, 'all observed packaged smoke processes exited');
assert.equal(profiles.size > 0 && [...profiles].every(path => !existsSync(path)), true, 'observed synthetic packaged profiles removed');
assert.equal(offlineProcesses.size > 0, true, 'actual packaged process has offline resolver flag');
console.log(`Packaged smoke boundary verified; ${observed.length - 1} child processes exited`);
