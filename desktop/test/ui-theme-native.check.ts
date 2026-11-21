import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreferencesShell, runPreferencesShell } from './ui/preferences-drafts-native-build';

test('switch both built-in skins on live views, open menus and reading surfaces', { timeout: 100000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-ui-theme-'));
  mkdirSync(join(output, 'zh-CN'));
  await buildPreferencesShell(output);
  runPreferencesShell(output, 'zh-CN', 'themes');
  if (process.platform === 'linux') {
    const { observed } = JSON.parse(readFileSync(join(output, 'process-boundary.json'), 'utf8')) as { observed: number[] };
    const live = () => observed.filter(pid => existsSync(`/proc/${pid}`));
    for (let retry = 0; retry < 20 && live().length; retry++) await new Promise(resolve => setTimeout(resolve, 50));
    const remaining = live();
    writeFileSync(join(output, 'cleanup.json'), JSON.stringify({ remainingObservedPids: remaining }));
    assert.equal(remaining.length, 0, 'observed Electron processes exit');
  }
  rmSync(join(output, 'zh-CN', 'theme-profile'), { recursive: true, force: true });
});
