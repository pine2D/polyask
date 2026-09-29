import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import * as policy from '../src/main/idle-throttling-policy';
import * as activity from '../src/main/site-command-activity';
import { SiteCommandChannel } from '../src/main/site-command-channel';
function setup(enabled = true) {
  const ipc = new EventEmitter(), window = new EventEmitter();
  let minimized = false, interval: (() => void) | undefined;
  const contents = [1, 2].map(id => make(id));
  function make(id: number) {
    return Object.assign(new EventEmitter(), { id, allowed: false, isDestroyed: () => false, isLoading: () => false,
      setBackgroundThrottling(value: boolean) { this.allowed = value; },
      send(_name: string, envelope: any) { queueMicrotask(() => ipc.emit('polyask:site-response', { sender: this }, { requestId: envelope.requestId, result: { state: 'idle' } })); }
    });
  }
  Object.assign(window, { isDestroyed: () => false, isMinimized: () => minimized });
  const source = { getStatuses: () => contents.map(c => ({ site: c.id, phase: 'ready' })),
    getDiagnosticSites: () => contents.map(c => ({ site: c.id, webContentsId: c.id, attached: true, bounds: { width: 500, height: 500 } })) };
  const module = { exports: {} as { startIdleThrottlingExperiment: (w: unknown, s: unknown) => () => void } };
  runInNewContext(transformSync(readSource('src/main/idle-throttling.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, process: { env: enabled ? { POLYASK_IDLE_THROTTLING_EXPERIMENT: '1' } : {} }, Date,
    setInterval: (callback: () => void) => { interval = callback; return 1; }, clearInterval: () => { interval = undefined; },
    require: (name: string) => {
      if (name === 'electron') return { ipcMain: ipc, webContents: { fromId: (id: number) => contents.find(c => c.id === id) } };
      if (name === './idle-throttling-policy') return policy;
      if (name === './site-command-activity') return activity;
      if (name === './site-command-channel') return { SiteCommandChannel };
      throw Error(name);
    }
  });
  const stop = module.exports.startIdleThrottlingExperiment(window, source);
  return { contents, ipc, window, stop, hasTimer: () => !!interval,
    add: () => { const c = make(3); contents.push(c); return c; },
    minimize: async () => { minimized = true; window.emit('minimize'); await new Promise(r => setImmediate(r)); } };
}
test('disabled wiring creates no IPC/window/page listeners or timer', () => {
  const h = setup(false); assert.equal(h.ipc.eventNames().length, 0); assert.equal(h.window.eventNames().length, 0);
  assert.equal(h.hasTimer(), false); assert.ok(h.contents.every(c => c.eventNames().length === 0)); h.stop();
});
test('a new renderer submitted before the next tracking tick wakes already throttled peers', async () => {
  const h = setup();
  try { await h.minimize(); assert.ok(h.contents.every(c => c.allowed));
    const fresh = h.add(); activity.beforeSiteSubmit(fresh.id);
    assert.ok(h.contents.every(c => !c.allowed));
  } finally { h.stop(); }
});
test('same-document navigation wakes the whole window without a loading event', async () => {
  const h = setup();
  try { await h.minimize(); assert.ok(h.contents.every(c => c.allowed));
    h.contents[0].emit('did-start-navigation', { isMainFrame: true, isInPlace: true });
    assert.ok(h.contents.every(c => !c.allowed));
  } finally { h.stop(); }
});
test('dispose removes experiment IPC, window and content subscriptions', async () => {
  const h = setup(); await h.minimize(); h.stop();
  assert.equal(h.ipc.eventNames().length, 0); assert.equal(h.window.eventNames().length, 0);
  assert.equal(h.hasTimer(), false); assert.ok(h.contents.every(c => c.eventNames().length === 0 && !c.allowed));
});
