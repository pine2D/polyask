import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import * as contract from '../src/shared/notification';

test('notification IPC rejects foreign senders and caller payloads before requesting OS notification', () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const exported = { exports: {} as { registerNotificationIpc: (options: unknown) => () => void } };
  let requested = 0;
  runInNewContext(transformSync(readSource('src/main/notification-ipc.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module: exported, exports: exported.exports, require: (name: string) => {
      if (name === '../shared/notification') return contract;
      assert.equal(name, 'electron');
      return { ipcMain: { handle: (channel: string, handler: (event: unknown) => unknown) => handlers.set(channel, handler),
        removeHandler: (channel: string) => handlers.delete(channel) } };
    }
  });
  const dispose = exported.exports.registerNotificationIpc({ trusted: (event: unknown) => event === true,
    notifications: { status: () => ({ state: 'idle', revision: 0 }), test: () => { requested++; return { state: 'requested', revision: 1 }; } } });
  try {
    const handle = handlers.get(contract.NOTIFICATION_CHANNELS.test)!;
    assert.throws(() => handle(false), /untrusted_sender/);
    assert.throws(() => handle(true, { body: 'arbitrary text' }), /invalid_notification_request/);
    assert.equal(requested, 0);
    assert.equal((handle(true) as contract.NotificationStatus).state, 'requested'); assert.equal(requested, 1);
  } finally { dispose(); }
  assert.equal(handlers.size, 0);
});
