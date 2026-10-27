import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandPaletteShortcutRuntime } from '../src/main/command-palette-shortcut';
import { registerCommandPaletteShortcutIpc } from '../src/main/command-palette-shortcut-ipc';
import { OperationGate } from '../src/shared/operation-gate';

function harness() {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  let resetting = false, saved: unknown = null;
  const keys = new Set<string>(), gate = new OperationGate();
  const runtime = new CommandPaletteShortcutRuntime({ repository: { read: () => saved, write: key => { saved = key; } },
    transaction: action => action(), prepare: () => ({ commit() {}, rollback() {} }), publish() {} });
  const dispose = registerCommandPaletteShortcutIpc({
    ipcMain: { handle: (channel, action) => { handlers.set(channel, action); }, removeHandler: channel => { handlers.delete(channel); } },
    runtime, gate, isResetting: () => resetting, trustedShell: event => event === 'trusted'
  });
  return { runtime, gate, keys, handlers, dispose, saved: () => saved, clearStored: () => { saved = null; }, resetting: () => { resetting = true; },
    invoke: async (suffix: 'state' | 'set', value?: unknown, sender: unknown = 'trusted') => handlers.get(`polyask:command-palette-shortcut-${suffix}`)!(sender, value) };
}

test('shortcut IPC rejects foreign senders before reading or changing the binding', async () => {
  const h = harness();
  try {
    await assert.rejects(h.invoke('state', undefined, 'foreign'), /untrusted_sender/);
    await assert.rejects(h.invoke('set', 'obsidian', 'foreign'), /untrusted_sender/);
    assert.equal(h.keys.size, 0); assert.equal(h.saved(), null);
    assert.equal((await h.invoke('set', 'obsidian') as any).mode, 'obsidian');
  } finally { h.dispose(); h.runtime.dispose(); }
});

test('shortcut IPC cannot write during an operation or a local reset', async () => {
  const h = harness(); let finish!: () => void;
  try {
    const sending = h.gate.run(() => new Promise<void>(resolve => { finish = resolve; }));
    await assert.rejects(h.invoke('set', 'obsidian'), /operation_busy/);
    finish(); await sending;
    h.resetting();
    await assert.rejects(h.invoke('set', 'obsidian'), /operation_busy/);
    assert.equal(h.keys.size, 0); assert.equal(h.saved(), null);
  } finally { finish?.(); h.dispose(); h.runtime.dispose(); }
});

test('shortcut IPC returns reset state if its reply completes after reset and removes handlers on dispose', async () => {
  const h = harness();
  const removeIdle = h.gate.onIdle(() => { h.clearStored(); h.runtime.refreshAfterReset(); });
  const result = await h.invoke('set', 'obsidian') as any;
  assert.equal(result.mode, 'standard'); assert.equal(result.error, null);
  assert.equal(h.keys.size, 0);
  removeIdle(); h.dispose();
  assert.equal(h.handlers.size, 0);
  h.runtime.dispose();
});

test('palette IPC rejects invalid values and callbacks retained after disposal', async () => {
  const h = harness(); const callback = h.handlers.get('polyask:command-palette-shortcut-set')!;
  await assert.rejects(h.invoke('set', 'Ctrl+P'), /invalid_request/); assert.equal(h.saved(), null);
  h.dispose(); await assert.rejects(async () => callback('trusted', 'obsidian'), /untrusted_sender/);
  assert.equal(h.saved(), null); h.runtime.dispose();
});
