import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import { NativePanelFocus } from '../src/main/native-panel-focus';

function harness() {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const ipc = Object.assign(new EventEmitter(), {
    handle: (channel: string, listener: (event: unknown, value?: unknown) => unknown) => {
      if (handlers.has(channel)) throw Error('duplicate_handler');
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => { handlers.delete(channel); }
  });
  const contents = Object.assign(new EventEmitter(), { focus: () => {} });
  let destroyed = false;
  const window = {
    isDestroyed: () => destroyed,
    get webContents() {
      if (destroyed) throw TypeError('Object has been destroyed');
      return contents;
    }
  };
  const module = { exports: {} as { registerShellPanelIpc: (...args: any[]) => () => void } };
  runInNewContext(transformSync(readSource('src/main/shell-panel-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module, exports: module.exports, require: (name: string) => {
      if (name === './native-panel-focus') return { NativePanelFocus };
      if (name === 'electron') return { webContents: { getFocusedWebContents: () => null } };
      throw Error(name);
    }
  });
  const register = () => module.exports.registerShellPanelIpc(ipc, window, { setDrawerOpen: () => {} }, () => true);
  return { ipc, contents, handlers, register, destroy: () => { destroyed = true; } };
}

for (const destroyed of [false, true]) {
  test(`panel disposal releases listeners, IPC and pending focus with window destroyed=${destroyed}`, async () => {
    const h = harness();
    const unrelated = () => {};
    h.contents.on('input-event', unrelated);
    const dispose = h.register();
    h.ipc.emit('polyask:set-drawer-open', {}, true);
    const pending = h.handlers.get('polyask:restore-panel-focus')!({});
    if (destroyed) h.destroy();
    assert.doesNotThrow(dispose);
    assert.equal(await pending, false, 'closing settles pending focus without restoring a destroyed target');
    assert.equal(h.contents.listeners('input-event').length, 1);
    assert.equal(h.contents.listeners('input-event')[0] === unrelated, true);
    assert.equal(h.contents.listenerCount('did-navigate'), 0);
    assert.equal(h.ipc.listenerCount('polyask:set-surface'), 0);
    assert.equal(h.ipc.listenerCount('polyask:set-drawer-open'), 0);
    assert.equal(h.handlers.size, 0);
  });
}

test('panel IPC can be registered again after disposal without duplicate handlers', () => {
  const h = harness();
  h.register()();
  const dispose = h.register();
  assert.equal(h.handlers.size, 2);
  assert.equal(h.ipc.listenerCount('polyask:set-surface'), 1);
  dispose();
  assert.equal(h.handlers.size, 0);
});
