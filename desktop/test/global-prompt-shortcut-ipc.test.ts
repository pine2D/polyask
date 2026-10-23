import assert from 'node:assert/strict';
import test from 'node:test';
import { GlobalPromptShortcutRuntime } from '../src/main/global-prompt-shortcut';
import { registerGlobalPromptShortcutIpc } from '../src/main/global-prompt-shortcut-ipc';
import { OperationGate } from '../src/shared/operation-gate';

function harness() {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  let resetting = false, saved: string | null = null;
  const keys = new Set<string>(), gate = new OperationGate();
  const runtime = new GlobalPromptShortcutRuntime({ repository: { read: () => saved, write: key => { saved = key; } },
    shortcuts: { register: key => { keys.add(key); return true; }, unregister: key => { keys.delete(key); } }, activate() {} });
  const dispose = registerGlobalPromptShortcutIpc({
    ipcMain: { handle: (channel, action) => { handlers.set(channel, action); }, removeHandler: channel => { handlers.delete(channel); } },
    runtime, gate, isResetting: () => resetting, trustedShell: event => event === 'trusted'
  });
  return { runtime, gate, keys, handlers, dispose, saved: () => saved, resetting: () => { resetting = true; },
    invoke: async (suffix: 'state' | 'set', value?: unknown, sender: unknown = 'trusted') => handlers.get(`polyask:global-prompt-shortcut-${suffix}`)!(sender, value) };
}

test('shortcut IPC rejects foreign senders before reading or changing the binding', async () => {
  const h = harness();
  try {
    await assert.rejects(h.invoke('state', undefined, 'foreign'), /untrusted_sender/);
    await assert.rejects(h.invoke('set', 'Control+Alt+Q', 'foreign'), /untrusted_sender/);
    assert.equal(h.keys.size, 0); assert.equal(h.saved(), null);
    assert.equal((await h.invoke('set', 'Control+Alt+Q') as any).status, 'registered');
  } finally { h.dispose(); h.runtime.dispose(); }
});

test('shortcut IPC cannot write during an operation or a local reset', async () => {
  const h = harness(); let finish!: () => void;
  try {
    const sending = h.gate.run(() => new Promise<void>(resolve => { finish = resolve; }));
    await assert.rejects(h.invoke('set', 'Control+Alt+Q'), /operation_busy/);
    finish(); await sending;
    h.resetting();
    await assert.rejects(h.invoke('set', 'Control+Alt+Q'), /operation_busy/);
    assert.equal(h.keys.size, 0); assert.equal(h.saved(), null);
  } finally { finish?.(); h.dispose(); h.runtime.dispose(); }
});

test('shortcut IPC returns reset state if its reply completes after reset and removes handlers on dispose', async () => {
  const h = harness();
  const removeIdle = h.gate.onIdle(() => h.runtime.reset());
  const result = await h.invoke('set', 'Control+Alt+Q') as any;
  assert.equal(result.status, 'disabled'); assert.equal(result.activeAccelerator, null);
  assert.equal(h.keys.size, 0);
  removeIdle(); h.dispose();
  assert.equal(h.handlers.size, 0);
  h.runtime.dispose();
});
