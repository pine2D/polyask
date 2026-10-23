import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import * as report from '../src/shared/report-export';
import { readSource } from './fixtures';

test('report IPC trusts only the shell, strips no forbidden intent, and owns native save dialog and disposal', async () => {
  let handler: ((event: boolean, value: unknown) => unknown) | undefined, serviceOptions: any, dialogOptions: any;
  let exports = 0, disposed = 0, removed = 0;
  class Service {
    constructor(options: unknown) { serviceOptions = options; }
    export(value: report.ReportExportRequest) { exports++; return value; }
    dispose() { disposed++; }
  }
  const module = { exports: {} as { registerReportExportIpc: (options: unknown) => () => void } };
  runInNewContext(transformSync(readSource('src/main/report-export-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Error, require: (name: string) => {
      if (name === '../shared/report-export') return report;
      if (name === './report-export-service') return { ReportExportService: Service };
      if (name === './report-pdf') return { printReportPdf: () => {} };
      if (name === 'electron') return { ipcMain: {
        handle: (channel: string, run: typeof handler) => { assert.equal(channel, 'polyask:report-export'); handler = run; },
        removeHandler: (channel: string) => { assert.equal(channel, 'polyask:report-export'); removed++; }
      }, dialog: { showSaveDialog: async (_window: unknown, options: unknown) => { dialogOptions = options; return { canceled: false, filePath: '/native/chosen.pdf' }; } } };
      throw new Error(name);
    }
  });
  const dispose = module.exports.registerReportExportIpc({ window: {}, trusted: (event: boolean) => event,
    archives: {}, decisions: {}, epoch: () => 0, isCurrent: () => true });
  const request = { kind: 'archive', id: 'record', format: 'pdf', locale: 'zhCN' };
  assert.throws(() => handler!(false, request), /untrusted_sender/); assert.equal(exports, 0);
  assert.throws(() => handler!(true, { ...request, path: '/renderer.pdf' }), /invalid_request/); assert.equal(exports, 0);
  assert.deepEqual(handler!(true, request), request); assert.equal(exports, 1);
  assert.equal(await serviceOptions.choosePath(request, 'polyask.pdf'), '/native/chosen.pdf');
  assert.equal(dialogOptions.defaultPath, 'polyask.pdf'); assert.equal(dialogOptions.filters[0].extensions.join(','), 'pdf');
  dispose(); assert.equal(disposed, 1); assert.equal(removed, 1);
});
