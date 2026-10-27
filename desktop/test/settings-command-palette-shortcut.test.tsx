import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SettingsCommandPaletteShortcut } from '../src/renderer/settings-command-palette-shortcut';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { CommandPaletteShortcutState } from '../src/shared/command-palette-shortcut';
import { mountDom } from './ui/dom-harness';
const standard: CommandPaletteShortcutState = { mode: 'standard', revision: 1, error: null };
const obsidian: CommandPaletteShortcutState = { mode: 'obsidian', revision: 2, error: null };
function api(patch: Record<string, unknown> = {}) {
  setShellApi({ commandPaletteShortcutState: async () => standard, setCommandPaletteShortcut: async () => obsidian,
    onCommandPaletteShortcut: () => () => {}, ...patch } as any);
}
async function choose(h: Awaited<ReturnType<typeof mountDom>>, value: string) {
  await act(async () => { const select = h.document.querySelector('select')!; select.value = value;
    select.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
}
for (const locale of ['en', 'zh-CN', 'zh-TW']) test(`${locale}: one local binding and only a brief overwrite hint`, async () => {
  api(); const h = await mountDom(<SettingsCommandPaletteShortcut copy={getCopy(locale)} isMac={false} disabled={false} />);
  try {
    assert.equal(h.document.querySelectorAll('option').length, 2);
    assert.equal(h.document.querySelector('select')!.value, 'standard');
    assert.equal(h.document.querySelector('[data-command-shortcut-conflict]') === null, true);
    await choose(h, 'obsidian');
    assert.equal(h.document.querySelector('select')!.value, 'obsidian');
    assert.equal(!!h.document.querySelector('[data-command-shortcut-conflict]')?.textContent, true);
    const text = h.document.body.textContent!;
    assert.equal(/VS Code|Obsidian|为什么|為什麼|Why|Alt\+K|F1/.test(text), false);
    for (const option of h.document.querySelectorAll('option')) assert.equal(!!option.textContent, true);
  } finally { await h.close(); setShellApi(null); }
});
test('save failure keeps the active selection, reports finite text, and blocks duplicate saves', async () => {
  let finish!: (state: CommandPaletteShortcutState) => void, calls = 0; const feedback: string[] = [];
  api({ setCommandPaletteShortcut: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const h = await mountDom(<SettingsCommandPaletteShortcut copy={getCopy('en')} isMac={false} disabled={false} onFeedback={text => feedback.push(text)} />);
  try {
    await choose(h, 'obsidian'); await choose(h, 'standard');
    assert.equal(calls, 1); assert.equal(h.document.querySelector('select')!.disabled, true);
    await act(async () => finish({ ...standard, revision: 2, error: 'command_shortcut_save_failed' }));
    assert.equal(h.document.querySelector('select')!.value, 'standard'); assert.equal(feedback.length, 1);
    assert.equal(h.document.querySelector('select')!.disabled, false);
  } finally { await h.close(); setShellApi(null); }
});
test('subscription precedes read and a late initial response cannot undo a newer event', async () => {
  let finish!: (state: CommandPaletteShortcutState) => void, listener!: (state: CommandPaletteShortcutState) => void;
  api({ onCommandPaletteShortcut: (callback: typeof listener) => { listener = callback; return () => {}; },
    commandPaletteShortcutState: () => { assert.equal(typeof listener, 'function'); return new Promise(resolve => { finish = resolve; }); } });
  const h = await mountDom(<SettingsCommandPaletteShortcut copy={getCopy('en')} isMac disabled={false} />);
  try {
    assert.equal(h.document.querySelector('select')!.disabled, true);
    await act(async () => listener(obsidian)); await act(async () => finish(standard));
    assert.equal(h.document.querySelector('select')!.value, 'obsidian');
    assert.equal(h.document.querySelector('option[value="obsidian"]')!.textContent!.includes('⌘'), true);
  } finally { await h.close(); setShellApi(null); }
});
test('reset events outrank late save replies and failed reads can be retried without exposing private errors', async () => {
  let reads = 0, finish!: (state: CommandPaletteShortcutState) => void, listener!: (state: CommandPaletteShortcutState) => void;
  api({ onCommandPaletteShortcut: (callback: typeof listener) => { listener = callback; return () => {}; },
    commandPaletteShortcutState: async () => { if (++reads === 1) throw Error('private detail'); return standard; },
    setCommandPaletteShortcut: () => new Promise(resolve => { finish = resolve; }) });
  const props = { copy: getCopy('en'), isMac: false, disabled: false };
  const h = await mountDom(<SettingsCommandPaletteShortcut {...props} />);
  try {
    assert.equal(h.document.querySelector('select')!.disabled, true);
    assert.equal(h.document.body.textContent!.includes('private detail'), false);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-command-shortcut-retry]')!);
    await choose(h, 'obsidian'); await act(async () => listener({ ...standard, revision: 3 }));
    await act(async () => finish(obsidian)); assert.equal(h.document.querySelector('select')!.value, 'standard');
  } finally { await h.close(); setShellApi(null); }
});

test('a newer reset clears old feedback and a late rejected save cannot announce failure for it', async () => {
  let reject!: (error: Error) => void, listener!: (state: CommandPaletteShortcutState) => void;
  let pending = false; const feedback: string[] = [];
  api({ onCommandPaletteShortcut: (callback: typeof listener) => { listener = callback; return () => {}; },
    setCommandPaletteShortcut: () => pending ? new Promise((_resolve, fail) => { reject = fail; })
      : Promise.resolve({ ...standard, revision: 2, error: 'command_shortcut_save_failed' }) });
  const h = await mountDom(<SettingsCommandPaletteShortcut copy={getCopy('en')} isMac={false} disabled={false} onFeedback={value => feedback.push(value)} />);
  try {
    await choose(h, 'obsidian'); assert.equal(feedback.length, 1);
    await act(async () => listener({ ...standard, revision: 3 }));
    assert.equal(h.document.body.textContent!.includes(getCopy('en').commandShortcutSaveFailed), false);
    pending = true; await choose(h, 'obsidian');
    await act(async () => listener({ ...standard, revision: 4 }));
    await act(async () => reject(Error('old failure')));
    assert.equal(h.document.querySelector('select')!.value, 'standard'); assert.equal(feedback.length, 1);
  } finally { await h.close(); setShellApi(null); }
});
