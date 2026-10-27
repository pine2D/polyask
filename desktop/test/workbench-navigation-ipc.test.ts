import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerWorkbenchNavigationIpc } from '../src/main/workbench-navigation-ipc';
import type { ViewManager } from '../src/main/view-manager';

test('navigation IPC protects current-site focus and removes its handlers on disposal', () => {
  const ipc = Object.assign(new EventEmitter(), {
    handle: (channel: string, fn: (event: any) => unknown) => handlers.set(channel, fn),
    removeHandler: (channel: string) => { handlers.delete(channel); }
  });
  const handlers = new Map<string, (event: any) => unknown>();
  let focused = 0;
  const dispose = registerWorkbenchNavigationIpc(ipc, { focusCurrentSite: () => { focused++; } } as unknown as ViewManager,
    event => event.trusted === true);
  ipc.emit('polyask:focus-current-site', { trusted: false }); assert.equal(focused, 0);
  ipc.emit('polyask:focus-current-site', { trusted: true }); assert.equal(focused, 1);
  dispose(); ipc.emit('polyask:focus-current-site', { trusted: true }); assert.equal(focused, 1);
  assert.equal(ipc.eventNames().length, 0); assert.equal(handlers.size, 0);
});
