import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { CommandPaletteShortcutRuntime } from '../src/main/command-palette-shortcut';
import { bindApplicationCommandInput } from '../src/main/application-command-routing';
import { parseCommandPaletteShortcut, type CommandPaletteShortcutState } from '../src/shared/command-palette-shortcut';

function harness(initial: unknown = null) {
  let stored = initial, menu = 'standard', failure = '';
  const published: CommandPaletteShortcutState[] = [], writes: unknown[] = [];
  const runtime = new CommandPaletteShortcutRuntime({
    repository: { read: () => { if (failure === 'read') throw Error('private detail'); return stored; },
      write: value => { if (failure === 'write') throw Error('private detail'); stored = value; writes.push(value); } },
    transaction: action => { const old = stored; try { return action(); } catch (error) { stored = old; throw error; } },
    prepare: mode => {
      if (failure === 'prepare') throw Error('private detail');
      const old = menu;
      return { commit: () => { menu = mode; if (failure === 'commit') throw Error('private detail'); }, rollback: () => { menu = old; } };
    }, publish: state => published.push(state)
  });
  return { runtime, published, writes, stored: () => stored, menu: () => menu,
    store: (value: unknown) => { stored = value; }, fail: (value: string) => { failure = value; } };
}
test('palette mode parser is strict and restore falls back to standard without writing corrupt data', () => {
  assert.equal(parseCommandPaletteShortcut('standard'), 'standard');
  assert.equal(parseCommandPaletteShortcut('obsidian'), 'obsidian');
  for (const value of [null, undefined, {}, 'Ctrl+P', 'STANDARD', 1]) {
    assert.equal(parseCommandPaletteShortcut(value), null);
    const h = harness(value); assert.equal(h.runtime.restore().mode, 'standard'); assert.equal(h.writes.length, 0);
  }
  assert.equal(harness('obsidian').runtime.restore().mode, 'obsidian');
});
test('successful palette replacements publish one effective state and restart restores it', () => {
  const h = harness(); h.runtime.restore(); const before = h.runtime.getState().revision;
  const state = h.runtime.configure('obsidian');
  assert.equal(state.mode, 'obsidian'); assert.equal(state.error, null);
  assert.equal(state.revision > before, true); assert.equal(h.menu(), 'obsidian'); assert.equal(h.stored(), 'obsidian');
  assert.equal(h.published.at(-1)?.revision, state.revision);
  assert.equal(harness(h.stored()).runtime.restore().mode, 'obsidian');
  assert.throws(() => h.runtime.configure('invalid'), /invalid_request/);
});
for (const [failure, code] of [['write', 'command_shortcut_save_failed'], ['prepare', 'command_shortcut_apply_failed'], ['commit', 'command_shortcut_apply_failed']] as const) {
  test(`${failure}: failed replacement rolls back both storage and menu`, () => {
    const h = harness('obsidian'); h.runtime.restore(); h.fail(failure);
    const state = h.runtime.configure('standard');
    assert.equal(state.error, code); assert.equal(state.mode, 'obsidian');
    assert.equal(h.menu(), 'obsidian'); assert.equal(h.stored(), 'obsidian');
    assert.equal(h.published.at(-1)?.error, code);
  });
}
test('reset cleanup re-reads actual storage and revisions advance even after a failed wipe', () => {
  const h = harness('obsidian'); h.runtime.restore(); const old = h.runtime.getState().revision;
  assert.equal(h.runtime.refreshAfterReset().mode, 'obsidian');
  assert.equal(h.runtime.getState().revision > old, true);
  h.fail('read'); assert.equal(h.runtime.refreshAfterReset().error, 'command_shortcut_read_failed');
  assert.equal(h.runtime.getState().mode, 'obsidian');
  h.fail(''); h.store(null); assert.equal(h.runtime.refreshAfterReset().mode, 'standard'); assert.equal(h.menu(), 'standard');
  h.runtime.dispose(); const count = h.writes.length;
  assert.equal(h.runtime.configure('obsidian').error, 'command_shortcut_apply_failed'); assert.equal(h.writes.length, count);
});
test('native input binding suppresses menu accelerators during IME and owns only matched inputs', () => {
  const ignored: boolean[] = [], commands: string[] = []; let mode: 'standard' | 'obsidian' = 'standard', prevented = 0;
  const contents = Object.assign(new EventEmitter(), { setIgnoreMenuShortcuts: (value: boolean) => ignored.push(value), isDestroyed: () => false });
  const cleanup = bindApplicationCommandInput(contents as any, () => mode, id => commands.push(id));
  const input = { type: 'keyDown', key: 'p', control: process.platform !== 'darwin', meta: process.platform === 'darwin', alt: false, shift: true };
  const send = (patch: Record<string, unknown> = {}) => contents.emit('before-input-event', { preventDefault: () => { prevented++; } }, { ...input, ...patch });
  send({ isComposing: true }); assert.equal(prevented, 0); assert.equal(ignored.at(-1), true);
  send(); assert.equal(prevented, 1); assert.equal(ignored.at(-1), false);
  send({ shift: false }); assert.equal(prevented, 1);
  mode = 'obsidian'; send({ shift: false }); assert.equal(prevented, 2);
  send(); send({ type: 'keyUp', shift: false }); assert.equal(prevented, 3);
  assert.deepEqual(commands, ['open-command-palette', 'open-command-palette']);
  send({ isComposing: true }); cleanup(); assert.equal(ignored.at(-1), false);
  assert.equal(contents.listenerCount('before-input-event'), 0);
});

test('reserved Alt input consumes the full key sequence and never repeats a toggle', () => {
  const commands: string[] = []; let prevented = 0;
  const contents = Object.assign(new EventEmitter(), { setIgnoreMenuShortcuts: () => {}, isDestroyed: () => false });
  const cleanup = bindApplicationCommandInput(contents as any, () => 'standard', id => commands.push(id));
  const input = { type: 'keyDown', key: 'q', code: 'KeyQ', control: false, meta: false, alt: true, shift: false };
  const send = (patch = {}) => contents.emit('before-input-event', { preventDefault: () => prevented++ }, { ...input, ...patch });
  send(); send({ isAutoRepeat: true }); send({ type: 'keyUp', alt: false });
  assert.equal(prevented, 3, 'no down, repeat or release leaks into the site');
  assert.equal(commands.join(','), 'focus-prompt');
  send(); send({ type: 'keyUp' });
  assert.equal(commands.join(','), 'focus-prompt,focus-prompt', 'a new physical press toggles again');
  send({ isComposing: true }); send({ modifiers: ['altGr'], control: true });
  assert.equal(prevented, 5, 'IME and AltGr remain page input');
  cleanup(); assert.equal(contents.listenerCount('before-input-event'), 0);
});
