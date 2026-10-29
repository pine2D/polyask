import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildSync } from 'esbuild';

test('real Electron close and destroy run panel cleanup through the closed event', async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-panel-lifecycle-'));
  buildSync({ entryPoints: [join(__dirname, '../src/main/shell-panel-ipc.ts')], bundle: true,
    platform: 'node', format: 'cjs', external: ['electron'], outfile: join(output, 'panels.cjs') });
  const binary = require('electron') as string;
  const args = [join(__dirname, 'ui/shell-panel-lifecycle-runtime.cjs'), output];
  const headless = process.platform === 'linux';
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args, {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      WAYLAND_DISPLAY: '', WAYLAND_SOCKET: '',
      ...(headless ? { DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}` } : {}) }
  });
  writeFileSync(join(output, 'runtime.log'), `${result.stdout}\n${result.stderr}`);
  console.log(`Panel lifecycle evidence: ${output}\n${result.stdout}`);
  assert.equal(result.error === undefined, true, result.error?.message ?? '');
  if (process.platform === 'linux') {
    assert.equal(existsSync(join(output, 'process-boundary.json')), true, 'native process boundary was observed');
    const { observed } = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')) as { observed: number[] };
    for (let round = 0; round < 20 && observed.some(pid => existsSync(`/proc/${pid}`)); round++) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const remaining = observed.filter(pid => existsSync(`/proc/${pid}`));
    assert.equal(remaining.length, 0, 'all observed Electron processes exited before profile cleanup');
  }
  rmSync(join(output, 'profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('PANEL_LIFECYCLE_COMPLETE'), true);
});
