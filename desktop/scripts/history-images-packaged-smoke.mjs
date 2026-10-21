// Actual packaged main/preload smoke with owned descendant cleanup on every exit path.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedNative, ownedCommandLine } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'polyask-history-images-smoke-'));
console.log(`Packaged smoke evidence: ${output}`);
const fault = process.argv.includes('--fault=monitor');
const boundary = processBoundary({ getAppMetrics: () => [] }, output);
const profiles = new Set(), offlineProcesses = new Set();
const result = await runOwnedNative({ command: 'xvfb-run',
  args: ['-a',process.execPath,join(root,'scripts/smoke.mjs'),'--skip-package','--offline'],
  cwd: root, output, timeout: 60000,
  env: {...process.env,DBUS_SESSION_BUS_ADDRESS:`unix:path=${join(output,'no-session-bus')}`},
  onStdout: chunk => process.stdout.write(chunk),
  onSample: observed => {
    // Discover cleanup paths independently of boundary IO: a failed boundary must not hide profiles.
    for (const value of observed) {
      const args = ownedCommandLine(value);
      const profile = args.find(arg => arg.startsWith('--user-data-dir='))?.slice(16);
      const directory = profile ? dirname(profile) : '';
      if (profile && dirname(directory) === tmpdir() && basename(directory).startsWith('polyask-smoke-') && basename(profile) === 'user-data') profiles.add(directory);
      if (args.includes('--host-resolver-rules=MAP * ~NOTFOUND')) offlineProcesses.add(value.pid);
    }
    if (fault && profiles.size && offlineProcesses.size) throw new Error('injected_packaged_monitor_failure');
    boundary();
  },
  cleanupPaths: observed => {
    // One final identity-checked read also covers a profile created between the last sample and failure.
    for (const value of observed) {
      const profile = ownedCommandLine(value).find(arg => arg.startsWith('--user-data-dir='))?.slice(16);
      if (profile && dirname(dirname(profile)) === tmpdir() && basename(dirname(profile)).startsWith('polyask-smoke-') && basename(profile) === 'user-data') profiles.add(dirname(profile));
    }
    return [...profiles];
  }
});
assert.equal(profiles.size > 0 && offlineProcesses.size > 0, true, 'observed packaged synthetic profile and offline resolver');
console.log(`Packaged smoke boundary verified; ${result.observed.length} owned processes exited`);
