import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import test from 'node:test';
import { CommandPalette, type CommandPaletteMode } from '../src/renderer/command-palette';
import { COMMANDS } from '../src/shared/commands';
import { getCopy } from '../src/shared/copy';
import { shortcutLabel } from '../src/renderer/shortcut-label';
import { mountDom } from './ui/dom-harness';

const noop = () => {};
function Host({ locale = 'en', isMac = false, effects = [] }: { locale?: string; isMac?: boolean; effects?: string[] }) {
  const [mode, setMode] = useState<CommandPaletteMode>('shortcuts');
  return <CommandPalette copy={getCopy(locale)} commands={COMMANDS} groups={[]} menuShortcuts={[{ group: 'View', label: 'Reload', accelerator: 'CmdOrCtrl+R' }]}
    library={{ templates: [], history: [] }} draft="" isMac={isMac} mode={mode} onModeChange={setMode}
    onExecute={id => effects.push(id)} onApplyGroup={noop} onInsertPrompt={noop} onSaveTemplate={noop}
    onDeleteTemplate={noop} onClose={() => effects.push('close')} />;
}
const options = (doc: Document) => [...doc.querySelectorAll('#command-results [role="option"]')];

for (const [locale, isMac] of [['en', true], ['zh-CN', false], ['zh-TW', false]] as const) {
  test(`${locale}: shortcut reference searches actions, localized categories and displayed keys`, async () => {
    const h = await mountDom(<Host locale={locale} isMac={isMac} />);
    try {
      const input = h.document.querySelector<HTMLInputElement>('input[type="search"]');
      assert.equal(input !== null, true, 'shortcut reference has a search field');
      assert.equal(h.document.activeElement === input, true);
      const all = options(h.document).length; assert.equal(all > 10, true);
      await h.input(input!, getCopy(locale).commandGroupNavigate);
      assert.equal(options(h.document).length > 0, true);
      assert.equal(options(h.document).every(node => node.querySelector('small')?.textContent === getCopy(locale).commandGroupNavigate), true);
      await h.input(input!, 'Reload'); assert.equal(options(h.document).length, 1);
      await h.input(input!, shortcutLabel('CmdOrCtrl+R', isMac));
      assert.equal(options(h.document).length, 1); assert.equal(options(h.document)[0]?.querySelector('strong')?.textContent, 'Reload');
      await h.input(input!, 'no such shortcut'); assert.equal(options(h.document).length, 0);
      assert.equal(h.document.querySelector('.command-empty') !== null, true);
      await h.input(input!, ''); assert.equal(options(h.document).length, all);
    } finally { await h.close(); }
  });
}

test('shortcut filtering preserves IME, activates a result with Enter and exits with Escape', async () => {
  const effects: string[] = [], h = await mountDom(<Host effects={effects} />);
  try {
    const input = h.document.querySelector<HTMLInputElement>('input[type="search"]');
    assert.equal(input !== null, true);
    await h.input(input!, 'F1'); assert.equal(options(h.document).length, 1);
    for (const key of ['Enter', 'Escape']) {
      const event = new h.window.KeyboardEvent('keydown', { key, keyCode: 229, bubbles: true, cancelable: true });
      await act(async () => input!.dispatchEvent(event)); assert.equal(event.defaultPrevented, false);
    }
    assert.equal(effects.length, 0);
    await act(async () => input!.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(effects.join(','), 'open-command-palette');
    await act(async () => input!.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(effects.at(-1), 'close');
  } finally { await h.close(); }
});

test('command search and shortcut search retain independent queries when switching tabs', async () => {
  const h = await mountDom(<Host />);
  try {
    const input = () => h.document.querySelector<HTMLInputElement>('input[type="search"]');
    assert.equal(input() !== null, true);
    await h.input(input()!, 'Reload');
    await h.click(h.document.getElementById('command-tab-commands')!); assert.equal(input()?.value, '');
    await h.input(input()!, 'drive');
    await h.click(h.document.getElementById('command-tab-shortcuts')!); assert.equal(input()?.value, 'Reload');
    assert.equal(options(h.document).length, 1);
    await h.click(h.document.getElementById('command-tab-commands')!); assert.equal(input()?.value, 'drive');
  } finally { await h.close(); }
});
