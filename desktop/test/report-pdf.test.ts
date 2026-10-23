import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { REPORT_CSP } from '../src/main/report-template';
import { readSource } from './fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function harness() {
  const partitions: string[] = [], windows: FakeWindow[] = [];
  let page: ((request: { url: string }) => Response) | null = null;
  let request: ((details: { url: string; resourceType: string }, callback: (value: { cancel: boolean }) => void) => void) | null = null;
  let permission: ((_contents: unknown, _name: string, callback: (allowed: boolean) => void) => void) | null = null;
  let permissionCheck: (() => boolean) | null = null;
  let load = async () => {}, print: () => Promise<Uint8Array> = async () => Buffer.from('%PDF-1.7'), delayDestroy = false;
  const destroyStarted = deferred<void>();
  const isolated = Object.assign(new EventEmitter(), {
    protocol: { handle: (_scheme: string, handler: typeof page) => { page = handler; }, unhandle: () => { page = null; } },
    webRequest: { onBeforeRequest: (handler: typeof request) => { request = handler; } },
    setPermissionRequestHandler: (handler: typeof permission) => { permission = handler; },
    setPermissionCheckHandler: (handler: typeof permissionCheck) => { permissionCheck = handler; }
  });
  class FakeWindow extends EventEmitter {
    destroyed = false;
    contentsDestroyed = false;
    options: any;
    url = '';
    printOptions: any;
    open: (() => { action: string }) | undefined;
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => this.contentsDestroyed,
      setWindowOpenHandler: (handler: typeof this.open) => { this.open = handler; },
      printToPDF: (options: unknown) => { this.printOptions = options; return print(); }
    });
    constructor(options: unknown) { super(); this.options = options; windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() {
      this.destroyed = true; this.emit('closed'); destroyStarted.resolve();
      if (!delayDestroy) this.releaseContents();
    }
    releaseContents() { this.contentsDestroyed = true; this.webContents.emit('destroyed'); }
    async loadURL(url: string) { this.url = url; await load(); }
  }
  const module = { exports: {} as { printReportPdf: (html: string, options: { signal: AbortSignal; guard: () => void; timeoutMs?: number }) => Promise<Uint8Array> } };
  runInNewContext(transformSync(readSource('src/main/report-pdf.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, Response, setTimeout, clearTimeout, Error,
    require: (name: string) => {
      if (name === 'electron') return { BrowserWindow: FakeWindow, session: { fromPartition: (partition: string, options: { cache: boolean }) => {
        assert.equal(options.cache, false); partitions.push(partition); return isolated;
      } } };
      if (name === 'node:crypto') return { randomUUID };
      if (name === './report-template') return { REPORT_CSP };
      throw new Error(name);
    }
  });
  return { render: module.exports.printReportPdf, windows, partitions,
    delayDestroy: () => { delayDestroy = true; }, destroyStarted: destroyStarted.promise,
    setLoad: (callback: typeof load) => { load = callback; }, setPrint: (callback: typeof print) => { print = callback; },
    page: () => page, request: () => request, permission: () => permission, permissionCheck: () => permissionCheck,
    isolated };
}

test('PDF renderer uses one isolated memory partition, denies capabilities and releases every per-job handler', async () => {
  const h = harness(), gate = deferred<Uint8Array>(), started = deferred<void>();
  h.setPrint(async () => { started.resolve(); return gate.promise; });
  const pending = h.render('<p>saved only</p>', { signal: new AbortController().signal, guard: () => {} });
  await started.promise;
  const w = h.windows[0], prefs = w.options.webPreferences;
  assert.equal(w.options.show, false);
  for (const name of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(prefs[name], true);
  for (const name of ['nodeIntegration', 'javascript', 'webviewTag', 'devTools']) assert.equal(prefs[name], false);
  assert.equal(prefs.preload, undefined); assert.equal(h.partitions[0].startsWith('persist:'), false);
  assert.equal(w.open?.().action, 'deny');
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false; w.webContents.emit(name, { preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  }
  let allowed = true;
  h.permission()!(null, 'clipboard-read', value => { allowed = value; }); assert.equal(allowed, false);
  assert.equal(h.permissionCheck()!(), false);
  for (const url of ['https://example.test/pixel', 'file:///private.txt', 'data:text/html,bad', `${w.url}?other`]) {
    let blocked = false; h.request()!({ url, resourceType: 'mainFrame' }, value => { blocked = value.cancel; }); assert.equal(blocked, true);
  }
  let blocked = true; h.request()!({ url: w.url, resourceType: 'mainFrame' }, value => { blocked = value.cancel; }); assert.equal(blocked, false);
  h.request()!({ url: w.url, resourceType: 'image' }, value => { blocked = value.cancel; }); assert.equal(blocked, true);
  assert.equal(await h.page()!({ url: w.url }).text(), '<p>saved only</p>');
  assert.equal(h.page()!({ url: `${w.url}?other` }).status, 404);
  assert.equal(w.printOptions.pageSize, 'A4'); assert.equal(w.printOptions.generateTaggedPDF, true);
  gate.resolve(Buffer.from('%PDF-1.7'));
  assert.equal(Buffer.from(await pending).toString(), '%PDF-1.7');
  assert.equal(w.destroyed, true); assert.equal(h.page() === null, true); assert.equal(h.request() === null, true);
  assert.equal(h.isolated.listenerCount('will-download'), 0);
  await h.render('<p>next</p>', { signal: new AbortController().signal, guard: () => {} });
  assert.equal(h.partitions[1], h.partitions[0]); assert.notEqual(h.windows[1].url, w.url);
});

test('PDF promise waits for actual WebContents destruction after BrowserWindow.destroy returns', async () => {
  const h = harness(); h.delayDestroy();
  let settled = false;
  const pending = h.render('<p>saved text</p>', { signal: new AbortController().signal, guard: () => {} })
    .then(value => { settled = true; return value; });
  await h.destroyStarted;
  assert.equal(h.windows[0].destroyed, true);
  assert.equal(h.windows[0].contentsDestroyed, false);
  assert.equal(settled, false);
  assert.equal(h.page() === null, false, 'template remains owned until its page is destroyed');
  h.windows[0].releaseContents(); await pending;
  assert.equal(settled, true); assert.equal(h.page() === null, true);
});

for (const outcome of ['load-failure', 'print-failure', 'timeout', 'abort', 'stale'] as const) test(`PDF ${outcome} destroys the temporary window and removes the template`, async () => {
  const h = harness(), gate = deferred<void>(), controller = new AbortController();
  let current = true;
  if (outcome === 'load-failure') h.setLoad(async () => { throw new Error('load failed'); });
  else if (outcome === 'print-failure') h.setPrint(async () => { throw new Error('print failed'); });
  else h.setLoad(() => gate.promise);
  const pending = h.render('<p>only saved text</p>', { signal: controller.signal,
    guard: () => { if (!current) throw new Error('report_source_changed'); }, timeoutMs: 5 });
  const rejected = assert.rejects(pending, outcome === 'timeout' ? /report_pdf_timeout/
    : outcome === 'abort' || outcome === 'stale' ? /report_source_changed/ : /failed/);
  if (outcome === 'abort') controller.abort();
  if (outcome === 'stale') { current = false; gate.resolve(); }
  await rejected;
  assert.equal(h.windows[0].destroyed, true);
  assert.equal(h.page() === null, true); assert.equal(h.request() === null, true);
  gate.resolve(); await Promise.resolve();
  assert.equal(h.windows.length, 1);
});
