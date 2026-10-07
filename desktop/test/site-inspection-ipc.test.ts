import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { SITE_KEYS } from '../src/shared/contracts';
import { readSource } from './fixtures';

test('inspection validates trusted input, returns the main decision and disposes its handler', () => {
  const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
  const exported = {exports: {} as {registerSiteInspectionIpc: (options: unknown) => () => void}};
  runInNewContext(transformSync(readSource('src/main/site-inspection-ipc.ts'), {loader:'ts',format:'cjs'}).code, {
    module: exported, exports: exported.exports, require: (name: string) => {
      if (name === '../shared/contracts') return {SITE_KEYS};
      assert.equal(name, 'electron');
      return {ipcMain: {handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key)}};
    }
  });
  let accepted = false;
  const events: string[] = [];
  const dispose = exported.exports.registerSiteInspectionIpc({trusted: (event: unknown) => event === true,
    manager: {setLayout: (mode: string, site: string) => { events.push(`${mode}:${site}`); return accepted; },
      setSurface: (surface: string) => { events.push(surface); }}});
  const invoke = handlers.get('polyask:inspect-site')!;
  assert.throws(() => invoke(false, 'claude'), /untrusted_sender/);
  assert.throws(() => invoke(true, '../other'), /invalid_site/);
  assert.equal(events.length, 0);
  assert.equal(invoke(true, 'claude'), false);
  assert.deepEqual(events, ['focus:claude']);
  accepted = true;
  assert.equal(invoke(true, 'claude'), true);
  assert.deepEqual(events, ['focus:claude', 'focus:claude', 'sites']);
  dispose(); assert.equal(handlers.size, 0);
});
