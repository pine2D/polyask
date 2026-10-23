import assert from 'node:assert/strict';
import test from 'node:test';
import { GlobalPromptShortcutRuntime } from '../src/main/global-prompt-shortcut';
import { parseGlobalPromptShortcut } from '../src/shared/global-prompt-shortcut';

function harness(initial: unknown = null) {
  let saved = initial, activated = 0, failWrite = false, failRegister = false;
  const registrations = new Map<string, () => void>(), removed: string[] = [], writes: unknown[] = [];
  const callbacks: (() => void)[] = [];
  const runtime = new GlobalPromptShortcutRuntime({ platform: 'linux',
    repository: { read: () => saved, write: value => {
      if (failWrite) throw new Error('private-path');
      saved = value; writes.push(value);
    } },
    shortcuts: { register: (key, callback) => {
      if (failRegister) throw new Error('os-private-detail');
      if (registrations.has(key)) return false;
      registrations.set(key, callback); callbacks.push(callback); return true;
    }, unregister: key => { registrations.delete(key); removed.push(key); } },
    activate: () => { activated++; }
  });
  return { runtime, registrations, removed, writes, callbacks, saved: () => saved, activated: () => activated,
    stored: (value: unknown) => { saved = value; },
    failWrite: () => { failWrite = true; }, failRegister: () => { failRegister = true; } };
}

test('shortcut parser accepts bounded combinations and rejects plain, ambiguous or malformed keys', () => {
  assert.equal(parseGlobalPromptShortcut(null), null);
  assert.equal(parseGlobalPromptShortcut(' shift + ctrl + q '), 'Control+Shift+Q');
  assert.equal(parseGlobalPromptShortcut('CmdOrCtrl+Alt+Space', true), 'Command+Alt+Space');
  assert.equal(parseGlobalPromptShortcut('Command+F24', false), 'Super+F24');
  for (const value of ['', 'Q', 'Shift+Q', 'Ctrl+Ctrl+Q', 'Ctrl++Q', 'Alt+F25', 'Alt+Q+W', 'Ctrl+Enter', '__proto__+Q', 'constructor+Q', {}, 1]) {
    assert.equal(parseGlobalPromptShortcut(value), undefined, `reject ${JSON.stringify(value)}`);
  }
});

test('default stays off and only an explicit valid setting registers an activation', () => {
  const h = harness();
  assert.equal(h.runtime.restore().status, 'disabled');
  assert.equal(h.registrations.size, 0);
  assert.equal(h.runtime.configure('Control+Alt+Q').status, 'registered');
  assert.equal(h.saved(), 'Control+Alt+Q');
  h.registrations.get('Control+Alt+Q')!();
  assert.equal(h.activated(), 1);
});

test('conflict and invalid changes preserve the previous working registration and saved value', () => {
  const h = harness('Control+Alt+Q'); h.runtime.restore();
  h.registrations.set('Control+Alt+W', () => {});
  assert.equal(h.runtime.configure('Control+Alt+W').error, 'conflict');
  assert.equal(h.runtime.getState().activeAccelerator, 'Control+Alt+Q');
  assert.equal(h.runtime.configure('Q').error, 'invalid');
  assert.equal(h.saved(), 'Control+Alt+Q');
  assert.equal(h.removed.length, 0);
  h.registrations.get('Control+Alt+Q')!(); assert.equal(h.activated(), 1);
});

test('save failure rolls back only the new registration and leaves the old binding active', () => {
  const h = harness('Control+Alt+Q'); h.runtime.restore(); h.failWrite();
  assert.equal(h.runtime.configure('Control+Alt+W').error, 'save_failed');
  assert.deepEqual(h.removed, ['Control+Alt+W']);
  assert.equal(h.runtime.getState().activeAccelerator, 'Control+Alt+Q');
  assert.equal(h.runtime.configure(null).error, 'save_failed');
  assert.equal(h.registrations.has('Control+Alt+Q'), true);
});

test('successful replacement and disable unregister only keys owned by this feature', () => {
  const h = harness('Control+Alt+Q'); h.registrations.set('Control+Alt+X', () => {}); h.runtime.restore();
  assert.equal(h.runtime.configure('Control+Alt+W').error, null);
  h.callbacks[0](); assert.equal(h.activated(), 0, 'old callbacks cannot activate a new binding');
  assert.equal(h.runtime.configure(null).status, 'disabled');
  assert.equal(h.saved(), null);
  assert.equal(h.registrations.has('Control+Alt+X'), true);
  assert.deepEqual(h.removed, ['Control+Alt+Q', 'Control+Alt+W']);
});

test('startup conflicts and OS failures report finite states without replacing the preference', () => {
  const h = harness('Control+Alt+Q'); h.registrations.set('Control+Alt+Q', () => {});
  assert.deepEqual(h.runtime.restore(), { accelerator: 'Control+Alt+Q', activeAccelerator: null, status: 'unavailable', error: 'conflict' });
  h.failRegister();
  assert.equal(h.runtime.configure('Control+Alt+W').error, 'unavailable');
  assert.equal(h.saved(), 'Control+Alt+Q');
  assert.equal(h.writes.length, 0);
});

test('restore is idempotent and a corrupt local value never reaches the OS', () => {
  const h = harness('Control+Alt+Q'); h.runtime.restore(); h.runtime.restore();
  assert.equal(h.callbacks.length, 1);
  const bad = harness({ accelerator: 'Control+Q' });
  assert.equal(bad.runtime.restore().error, 'invalid');
  assert.equal(bad.registrations.size, 0);
  assert.equal(bad.runtime.configure(null).status, 'disabled');
  assert.equal(bad.saved(), null, 'explicit off clears the invalid stored preference');
});

test('a reset triggered during registration cannot save or retain the candidate binding', () => {
  let writes = 0; const registered = new Set<string>();
  const runtime = new GlobalPromptShortcutRuntime({
    repository: { read: () => null, write: () => { writes++; } }, activate() {},
    shortcuts: { register: key => { registered.add(key); runtime.reset(); return true; }, unregister: key => { registered.delete(key); } }
  });
  assert.equal(runtime.configure('Control+Alt+Q').activeAccelerator, null);
  assert.equal(writes, 0); assert.equal(registered.size, 0);
});

test('reset and disposal invalidate callbacks; a new runtime can restore the saved setting', () => {
  const h = harness('Control+Alt+Q'); h.runtime.restore(); h.runtime.reset();
  h.callbacks[0](); assert.equal(h.activated(), 0);
  assert.equal(h.runtime.getState().status, 'disabled');
  assert.equal(h.runtime.configure('Control+Alt+W').status, 'registered');
  h.runtime.dispose(); h.runtime.dispose(); h.callbacks[1]();
  assert.equal(h.activated(), 0);
  assert.equal(h.runtime.configure('Control+Alt+X').error, 'unavailable');
  assert.equal(h.runtime.restore().activeAccelerator, null);
  assert.equal(h.saved(), 'Control+Alt+W', 'window destruction does not erase the user setting');
  assert.equal(harness(h.saved()).runtime.restore().activeAccelerator, 'Control+Alt+W');
});

test('reset cleanup retains a working binding when the database wipe failed and clears it only after a real wipe', () => {
  const h = harness('Control+Alt+Q'); h.runtime.restore();
  const before = h.runtime.lifecycle;
  assert.equal(h.runtime.refreshAfterReset().activeAccelerator, 'Control+Alt+Q');
  assert.equal(h.runtime.lifecycle > before, true, 'even failed reset invalidates in-flight IPC replies');
  h.callbacks[0](); assert.equal(h.activated(), 1, 'failed reset does not disable the saved shortcut');
  assert.equal(h.removed.length, 0);
  h.stored(null);
  assert.equal(h.runtime.refreshAfterReset().status, 'disabled');
  h.callbacks[0](); assert.equal(h.activated(), 1);
  assert.equal(h.registrations.size, 0);
});
