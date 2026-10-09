import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('xvfb-run', ['-a', process.execPath, 'scripts/test-safe.mjs', 'unit',
  'test/preferences-drafts-native.check.ts'], { cwd: root, stdio: 'inherit', timeout: 400000 });
process.exitCode = result.status ?? 1;
