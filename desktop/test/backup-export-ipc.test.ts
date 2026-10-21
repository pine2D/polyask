import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import * as path from 'node:path';
function harness() {
  const handlers = new Map<string, (event: boolean, value?: unknown) => Promise<any>>();
  const module = { exports: {} as { registerBackupIpc: (options: any) => () => void } };
  let generation = 0, saveDialogs = 0, writes = 0, downloads = 0, missing = true;
  let resolveFetch: (() => void) | undefined, pendingFetch: Promise<void> | undefined;
  let startDownload!: () => void;
  const started = new Promise<void>(resolve => { startDownload = resolve; });
  const modes: string[] = [];
  runInNewContext(transformSync(readSource('src/main/backup-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Date, Error, require: (name: string) => {
      if (name === 'node:path') return path;
      if (name !== 'electron') throw new Error(name);
      return { ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn), removeHandler: (channel: string) => handlers.delete(channel) },
        dialog: { showSaveDialog: async (_window: any, options: any) => {
          assert.equal(options.defaultPath.endsWith('.polyask'), true); saveDialogs++; return { canceled: false, filePath: '/chosen.polyask' };
        } } };
    }
  });
  const backup = {
    beginOperation: () => { const current = ++generation; return () => { if (current !== generation) throw new Error('backup_stale'); }; },
    missingOriginals: async () => missing ? [{ questionId: 'q', title: 'question', count: 1, images: [] }] : [],
    exportFile: async (file: string, mode: string) => { assert.equal(file, '/chosen.polyask'); modes.push(mode); writes++; },
    started, cancel: () => { generation++; }, dispose: () => { generation++; }
  };
  const dispose = module.exports.registerBackupIpc({ window: {}, backup, trusted: (event: boolean) => event, afterApply: () => {},
    fetchAttachments: async (id: string) => { assert.equal(id, 'q'); downloads++; startDownload(); await pendingFetch; return true; } });
  return { call: (value?: unknown) => handlers.get('polyask:backup-export')!(true, value),
    started, cancel: () => handlers.get('polyask:backup-cancel')!(true, 'pending'),
    reset: () => { generation++; }, dispose, setAvailable: () => { missing = false; },
    pauseDownload: () => { pendingFetch = new Promise(resolve => { resolveFetch = resolve; }); },
    finish: () => resolveFetch!(), stats: () => ({ saveDialogs, writes, downloads, modes }) };
}
test('missing originals are returned before a save dialog and text-only requires an explicit mode', async () => {
  const h = harness();
  try {
    assert.equal((await h.call()).missing[0].count, 1);
    assert.equal(h.stats().saveDialogs, 0); assert.equal(h.stats().downloads, 0);
    assert.equal(await h.call({ mode: 'text-only' }), 'text-only');
    assert.deepEqual(h.stats(), { saveDialogs: 1, writes: 1, downloads: 0, modes: ['text-only'] });
    for (const value of [{ mode: 'complete', path: '/renderer' }, { mode: 'other' }, [], null]) await assert.rejects(h.call(value), /invalid_request/);
  } finally { h.dispose(); }
});
test('explicit download still requires strict local completeness before exporting', async () => {
  const h = harness();
  try {
    assert.equal((await h.call({ mode: 'download' })).missing.length, 1, 'true from sync is not completeness proof');
    assert.equal(h.stats().downloads, 1); assert.equal(h.stats().saveDialogs, 0);
    h.setAvailable(); assert.equal(await h.call({ mode: 'download' }), true);
    assert.equal(h.stats().writes, 1);
  } finally { h.dispose(); }
});
for (const action of ['cancel', 'reset', 'dispose'] as const) test(`late download cannot open save dialog after ${action}`, async () => {
  const h = harness(); h.pauseDownload();
  const pending = h.call({ mode: 'download' });
  await h.started;
  assert.equal(h.stats().downloads, 1);
  if (action === 'cancel') await h.cancel(); else h[action]();
  h.setAvailable(); h.finish();
  await assert.rejects(pending, /backup_stale/);
  assert.equal(h.stats().saveDialogs, 0); assert.equal(h.stats().writes, 0);
  h.dispose();
});
