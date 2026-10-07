import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';

test('close IPC uses the trusted shell for both read-only preview and explicit close and disposes both handlers', async () => {
  const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
  const exported = { exports: {} as { registerSitePageIpc(options: unknown): () => void } };
  runInNewContext(transformSync(readSource('src/main/site-page-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module: exported, exports: exported.exports,
    require: (name: string) => {
      assert.equal(name, 'electron');
      return { ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler), removeHandler: (channel: string) => handlers.delete(channel) } };
    }
  });
  const calls: string[] = [];
  const dispose = exported.exports.registerSitePageIpc({ trusted: (event: unknown) => event === 'shell',
    service: { preview: (site: string) => { calls.push(`preview:${site}`); return { site, contentsId: 21, reason: null }; },
      close: (value: { site: string }) => { calls.push(`close:${value.site}`); return { state: 'closed' }; } } });
  assert.equal(handlers.size, 2);
  for (const handler of handlers.values()) await assert.rejects(Promise.resolve().then(() => handler('foreign', 'kimi')), /untrusted_sender/);
  assert.deepEqual(calls, []);
  handlers.get('polyask:preview-site-page-close')!('shell', 'kimi');
  assert.deepEqual(calls, ['preview:kimi']);
  handlers.get('polyask:close-site-page')!('shell', { site: 'kimi', contentsId: 21, confirmed: true });
  assert.deepEqual(calls, ['preview:kimi', 'close:kimi']);
  dispose(); assert.equal(handlers.size, 0);
});
