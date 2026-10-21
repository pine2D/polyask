// Fault-path integration only; package must already exist. Run through test-safe command mode.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runOwnedNative, ownedCommandLine } from './lib/owned-native-process.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const output = mkdtempSync(join(tmpdir(), 'polyask-history-cleanup-check-'));
console.log(`Fault cleanup evidence: ${output}`);
const report = [];
for (const [launcher, fault] of [['history-images-native.mjs','timeout'],['history-images-native.mjs','capture'],['history-images-packaged-smoke.mjs','monitor'],['history-images-native.mjs','signal']]) {
  const launcherName = launcher;
  const directory = join(output, fault); mkdirSync(directory);
  const boundary = processBoundary({ getAppMetrics: () => [] }, directory);
  let failed = false, transcript = '', signaled = false;
  try {
    await runOwnedNative({ command: process.execPath, args: [join(root,'scripts',launcher),`--fault=${fault === 'signal' ? 'timeout' : fault}`],
      cwd: root, env: process.env, output: directory, timeout: 15000, onStdout: chunk => { transcript += String(chunk); }, onSample: observed => {
        boundary();
        const evidence = transcript.match(/Native original-image evidence: (.+)/)?.[1];
        if (fault === 'signal' && !signaled && evidence && existsSync(join(evidence,'synthetic-data','owned-marker'))) {
          const launcher = observed.find(value => ownedCommandLine(value).includes(join(root,'scripts',launcherName)));
          if (launcher) { signaled = true; process.kill(launcher.pid,'SIGTERM'); }
        }
      } });
  } catch { failed = true; }
  assert.equal(failed, true, `${fault}: launcher must fail`);
  const log = readFileSync(join(directory,'runtime.log'),'utf8');
  const evidence = log.match(/(?:Native original-image|Packaged smoke) evidence: (.+)/)?.[1];
  assert.equal(typeof evidence, 'string', `${fault}: evidence path retained`);
  const cleanup = JSON.parse(readFileSync(join(evidence,'cleanup.json'),'utf8'));
  assert.equal(cleanup.live.length, 0, `${fault}: no running owned process`);
  assert.equal(cleanup.paths.length > 0 && cleanup.paths.every(path => !path.exists && !existsSync(path.path)), true, `${fault}: own synthetic paths removed`);
  if (fault === 'timeout') {
    assert.equal(cleanup.originalError.includes('owned_native_timeout:2000'), true);
    assert.equal(cleanup.signals.some(item => item.signal === 'SIGKILL'), true, 'stubborn Electron requires bounded KILL escalation');
    assert.equal(existsSync(join(evidence,'process-boundary.json')), false, 'runtime boundary absent exercises owned-child fallback');
  } else if (fault === 'capture') {
    assert.equal(log.includes('injected_native_failure') && log.includes('injected_capture_failure'), true, 'original failure and secondary capture rejection both retained');
    const failure = JSON.parse(readFileSync(join(evidence,'failure.json'),'utf8'));
    assert.equal(failure.error, 'Error: injected_native_failure');
  } else if (fault === 'signal') {
    assert.equal(signaled, true);
    assert.equal(cleanup.originalError.includes('owned_native_signal:SIGTERM'), true);
    const outerCleanup = JSON.parse(readFileSync(join(directory,'cleanup.json'),'utf8'));
    assert.equal(outerCleanup.terminationSignal, 'SIGTERM', 'launcher restores signal termination after finally');
  } else assert.equal(cleanup.originalError.includes('injected_packaged_monitor_failure'), true);
  const identities = new Set(cleanup.observed.map(value => `${value.pid}:${value.start}`));
  assert.equal(cleanup.signals.every(value => identities.has(`${value.pid}:${value.start}`)), true, 'all signals target observed process identities');
  const procEntries = cleanup.observed.filter(value => existsSync(`/proc/${value.pid}`)).map(value => value.pid);
  report.push({ fault, evidence, failed, observed: cleanup.observed.length, live: cleanup.live, paths: cleanup.paths, remainingProcEntries: procEntries, signals: cleanup.signals });
  console.log(JSON.stringify({fault,evidence,failed,observed:cleanup.observed.length,live:cleanup.live}));
}
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));
console.log('Fault cleanup checks passed: 4/4');
