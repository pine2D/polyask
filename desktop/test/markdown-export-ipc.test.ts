import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as api from '../src/shared/markdown-export';
import { readSource } from './fixtures';
test('both Markdown IPC routes reject untrusted senders and renderer paths before service reads', async () => {
  const handlers = new Map<string, (trusted: boolean, value: unknown) => unknown>(); let reads = 0, disposed = false;
  let options: any, dialogOptions: any;
  class Service {
    constructor(value: unknown) { options = value; }
    preview(value: api.MarkdownPreviewRequest) { reads++; return value.targets; }
    export(value: api.MarkdownExportRequest) { reads++; return value.selections; }
    dispose() { disposed = true; }
  }
  const module = { exports: {} as { registerMarkdownExportIpc: (options: unknown) => () => void } };
  runInNewContext(transformSync(readSource('src/main/markdown-export-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Error, require: (name: string) => {
      if (name === '../shared/markdown-export') return api;
      if (name === './markdown-export-service') return { MarkdownExportService: Service };
      if (name === 'electron') return { ipcMain: { handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key) },
        dialog: { showSaveDialog: async (_window: unknown, value: unknown) => { dialogOptions = value; return { canceled: false, filePath: '/native/chosen.md' }; } } };
      throw new Error(name);
    }
  });
  const dispose = module.exports.registerMarkdownExportIpc({ window: {}, trusted: (event: boolean) => event,
    archives: {}, decisions: {}, questions: {}, epoch: () => 0, isCurrent: () => true });
  for (const fn of handlers.values()) {
    assert.throws(() => fn(false, {}), /untrusted_sender/); assert.throws(() => fn(true, { path: '/renderer.md' }), /invalid_request/);
  }
  assert.equal(reads, 0);
  handlers.get('polyask:markdown-preview')!(true, { targets: [{ kind: 'history', id: 'q1' }] }); assert.equal(reads, 1);
  assert.equal(await options.choosePath('PolyAsk.md'), '/native/chosen.md');
  assert.equal(dialogOptions.defaultPath, 'PolyAsk.md'); assert.equal(dialogOptions.filters[0].extensions.join(','), 'md');
  dispose(); assert.equal(disposed, true); assert.equal(handlers.size, 0);
});
