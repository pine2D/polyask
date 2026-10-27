// Exercise the real npm/Forge development entry with an empty, offline profile only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, readlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedNative, ownedCommandLine } from './lib/owned-native-process.mjs';
const require = createRequire(import.meta.url);
const { processBoundary } = require('../test/ui/native-process-boundary.cjs');
if (process.platform !== 'linux') throw new Error('This native process-boundary check requires Linux');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = mkdtempSync(join(tmpdir(), 'polyask-dev-start-native-'));
const profile = join(output, 'profile'), diagnostic = join(output, 'diagnostic.json');
let observed = [], profileObserved = false, verified = false;
const boundary = processBoundary({ getAppMetrics: () => observed.map(value => ({ pid: value.pid })) }, output);
console.log(`Development startup evidence: ${output}`);
const result = await runOwnedNative({ command: 'xvfb-run',
  args: ['-a', 'npm', 'start', '--', '--', `--user-data-dir=${profile}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-background-networking'],
  cwd: root, output, timeout: 180000,
  env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: '', ELECTRON_RUN_AS_NODE: '',
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(output, 'no-session-bus')}`,
    POLYASK_DIAGNOSTICS_FILE: diagnostic, POLYASK_SOAK_REPORT: join(output, 'soak.jsonl'), POLYASK_SOAK_MINUTES: '0.1' },
  onStdout: chunk => { if (String(chunk).includes('Cookie encryption enabled')) verified = true; },
  onSample: values => {
    observed = values; boundary();
    for (const value of values) {
      const args = ownedCommandLine(value);
      let executable;
      try { executable = readlinkSync(`/proc/${value.pid}/exe`); } catch { continue; }
      if (!executable.includes('/test-artifacts/dev-runtime/') || basename(executable) !== 'electron') continue;
      if (args.includes(`--user-data-dir=${profile}`) && !args.some(arg => arg.startsWith('--type=')))
        assert.equal(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'), true);
      let descriptors;
      try { descriptors = readdirSync(`/proc/${value.pid}/fd`); } catch { continue; }
      for (const descriptor of descriptors) {
        let target;
        try { target = readlinkSync(`/proc/${value.pid}/fd/${descriptor}`); } catch { continue; }
        if (!target.endsWith('/polyask.sqlite')) continue;
        assert.equal(target, join(profile, 'polyask.sqlite'));
        profileObserved = true;
      }
    }
  },
  cleanupPaths: () => [profile]
});
const snapshot = JSON.parse(readFileSync(diagnostic, 'utf8'));
assert.equal(verified, true);
assert.equal(profileObserved, true);
assert.equal(snapshot.ok, true);
assert.equal(snapshot.shellCount, 1);
assert.equal(snapshot.sites.length, 9);
assert.equal(existsSync(profile), false);
console.log(`Verified development startup: 9 offline sites, exact temporary profile, ${result.observed.length} owned processes exited.`);
