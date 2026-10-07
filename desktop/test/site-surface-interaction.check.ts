import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

test('confirmation preserves native site viewports and restores only selected visibility', () => {
  const output = mkdtempSync(join(tmpdir(), 'polyask-site-surface-'));
  const source = readFileSync(join(__dirname, '../src/main/site-surface.ts'), 'utf8');
  writeFileSync(join(output, 'site-surface.cjs'), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText);
  const binary = require('electron') as string, args = [join(__dirname, 'ui/site-surface-runtime.cjs'), output];
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  const result = spawnSync(headless ? 'xvfb-run' : binary, headless ? ['-a', binary, ...args] : args,
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  console.log(result.stdout);
  assert.equal(result.status, 0, `${result.stderr}\n${result.error ?? ''}`);
  assert.match(result.stdout, /NATIVE_SURFACE_COMPLETE/);
});
