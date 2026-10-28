import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMANDS, resolveCommands,
  commandAliasForInput,
  commandAccelerator,
  commandById,
  type CommandId
} from "../src/shared/commands";
import { COPY } from "../src/shared/copy";
import { executeCommand } from "../src/renderer/command-dispatcher";

test("desktop commands have one unique registry entry and localized labels", () => {
  const ids = COMMANDS.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(commandById("open-command-palette")?.id, "open-command-palette");
  assert.equal(commandById("missing"), undefined);

  for (const command of COMMANDS) {
    assert.ok(COPY.en[command.labelKey]);
    assert.ok(COPY.zhCN[command.labelKey]);
    assert.ok(COPY.zhTW[command.labelKey]);
  }
});

test("desktop command accelerators reserve Alt shortcuts and platform settings keys", () => {
  assert.equal(commandAccelerator("open-command-palette", "win32"), "CmdOrCtrl+Shift+P");
  assert.equal(commandById("open-command-palette")?.aliases?.includes("F1") ?? false, false);
  assert.equal(commandAccelerator("open-sites", "linux"), "Alt+S");
  assert.equal(commandAccelerator("open-site-health", "win32"), "Alt+H");
  assert.equal(commandAccelerator("show-page-1", "win32"), "Alt+1");
  assert.equal(commandAccelerator("show-page-2", "win32"), "Alt+2");
  assert.equal(commandAccelerator("show-page-3", "win32"), "Alt+3");
  assert.equal(commandAccelerator("focus-prompt", "linux"), "Alt+Q");
  assert.equal(commandAccelerator("set-think", "win32"), "Alt+T");
  assert.equal(commandAccelerator("set-fast", "win32"), "Alt+Y");
  assert.equal(commandAccelerator("open-settings", "darwin"), "Command+, ".trim());
  assert.equal(commandAccelerator("open-settings", "win32"), "Control+,");
  assert.equal(commandAliasForInput({ type: "keyDown", key: "F1", alt: false, control: false, meta: false, shift: false }), undefined);
  assert.equal(commandAliasForInput({ type: "keyUp", key: "F1", alt: false, control: false, meta: false, shift: false }), undefined);
});

test("renderer command dispatch uses the shared command identifier", () => {
  const called: CommandId[] = [];
  const actions = {
    "open-sites": () => called.push("open-sites"),
    "focus-prompt": () => called.push("focus-prompt")
  };

  assert.equal(executeCommand("open-sites", actions), true);
  assert.equal(executeCommand("focus-prompt", actions), true);
  assert.equal(executeCommand("show-page-1", actions), false);
  assert.deepEqual(called, ["open-sites", "focus-prompt"]);
});

for (const platform of ['win32', 'linux', 'darwin'] as const) for (const mode of ['standard', 'obsidian'] as const) {
  test(`${platform}/${mode}: only the selected palette binding consumes a keydown`, () => {
    const accelerator = mode === 'standard' ? 'CmdOrCtrl+Shift+P' : 'CmdOrCtrl+P';
    assert.equal(commandAccelerator('open-command-palette', platform, mode), accelerator);
    assert.equal(resolveCommands(mode).find(item => item.id === 'open-command-palette')?.accelerator, accelerator);
    const input = { type: 'keyDown', key: 'p', alt: false, control: platform !== 'darwin', meta: platform === 'darwin', shift: mode === 'standard' };
    assert.equal(commandAliasForInput(input, platform, mode), 'open-command-palette');
    for (const patch of [{ type: 'keyUp' }, { isComposing: true }, { shift: !input.shift }, { alt: true },
      { control: !input.control, meta: !input.meta }, { control: true, meta: true },
      { key: 'F1', control: false, meta: false, shift: false }, { key: 'k', alt: true, control: false, meta: false, shift: false }]) {
      assert.equal(commandAliasForInput({ ...input, ...patch }, platform, mode), undefined);
    }
  });
}


test('returning to the current site does not reserve a redundant Alt+W binding', () => {
  assert.equal(commandById('focus-current-site')?.accelerator, undefined);
  assert.equal(commandById('next-site')?.accelerator, undefined);
  assert.equal(commandById('previous-site')?.accelerator, undefined);
});

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`${platform}: app bindings are intercepted before printable site handlers`, () => {
    const plain = { type: 'keyDown', key: 'q', alt: true, control: false, meta: false, shift: false };
    for (const [key, id] of [['q', 'focus-prompt'], ['s', 'open-sites'], ['h', 'open-site-health'],
      ['1', 'show-page-1'], ['2', 'show-page-2'], ['3', 'show-page-3'], ['t', 'set-think'], ['y', 'set-fast'],
      ['c', 'collect-answers'], ['r', 'retry-failed'], ['n', 'new-session'], ['ArrowLeft', 'site-back'], ['ArrowRight', 'site-forward']]) {
      assert.equal(commandAliasForInput({ ...plain, key }, platform), id);
    }
    for (const patch of [{ key: 'w' }, { shift: true }, { control: true }, { meta: true }, { alt: false },
      { isComposing: true }, { modifiers: ['altGr'] }, { type: 'keyUp' }]) {
      assert.equal(commandAliasForInput({ ...plain, ...patch }, platform), undefined);
    }
    const primary = { ...plain, alt: false, control: platform !== 'darwin', meta: platform === 'darwin' };
    assert.equal(commandAliasForInput({ ...primary, key: ',' }, platform), 'open-settings');
    assert.equal(commandAliasForInput({ ...primary, shift: true, key: 'PageUp' }, platform), 'previous-page');
    assert.equal(commandAliasForInput({ ...primary, shift: true, key: 'PageDown' }, platform), 'next-page');
  });
}
