import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreferencesShell, runPreferencesShell } from './ui/preferences-drafts-native-build';

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function inputManifest(): Record<string, string> {
  const base = join(__dirname, '..'), files: Record<string, string> = {};
  const visit = (relative: string) => {
    for (const entry of readdirSync(join(base, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path); else if (entry.isFile()) files[path] = digest(join(base, path));
    }
  };
  visit('src');
  for (const file of ['package.json', 'package-lock.json', 'test/preferences-drafts-native.check.ts',
    'scripts/preferences-drafts-native.mjs', 'test/ui/command-bar-layout.cjs',
    ...readdirSync(join(base, 'test/ui')).filter(name => name.startsWith('preferences-drafts-native-')).map(name => `test/ui/${name}`)]) {
    files[file] = digest(join(base, file));
  }
  return files;
}

test('isolated production preferences and draft editors survive native input, cloud pushes and process restart', { timeout: 360000 }, async () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-preferences-drafts-native-'));
  const inputs = inputManifest();
  await buildPreferencesShell(output);
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ inputs,
    artifacts: Object.fromEntries(['bundle.js', 'preload.cjs', 'manager.cjs', 'services.cjs', 'index.html'].map(name => [name, digest(join(output, name))])) }, null, 2));
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    mkdirSync(join(output, locale));
    runPreferencesShell(output, locale, 'write');
    runPreferencesShell(output, locale, 'read');
  }
  assert.deepEqual(inputManifest(), inputs, 'production sources and native harness must stay frozen throughout artifact validation');
});
