import assert from 'node:assert/strict';
import test from 'node:test';
import { shortcutReference } from '../src/renderer/shortcut-reference';
import { COMMANDS, resolveCommands } from '../src/shared/commands';
import { getCopy } from '../src/shared/copy';

test('native lower-case roles keep Select All beside the other editing actions', () => {
  const items = shortcutReference(COMMANDS, getCopy('en'), [
    { group:'Edit', label:'Select All', role:'selectall', accelerator:'Ctrl+A' },
    { group:'Edit', label:'Paste', role:'paste', accelerator:'Ctrl+V' },
    { group:'View', label:'Full screen', role:'togglefullscreen', accelerator:'F11' }
  ]);
  const edits = items.filter(item => item.group === 'edit');
  assert.equal(edits.map(item => item.label).join(','), 'Paste,Select All');
  assert.equal(items.at(-1)?.label, 'Select All');
});

test('complete reference uses the selected palette shortcut and keeps unavailable pages non-executable', () => {
  const registered = resolveCommands('obsidian');
  const available = registered.filter(item => item.id !== 'show-page-3');
  const items = shortcutReference(available, getCopy('zh-CN'), [], false, registered, 2);
  assert.equal(items.find(item => item.id === 'open-command-palette')?.accelerator, 'CmdOrCtrl+P');
  assert.equal(items.find(item => item.id === 'show-page-3')?.unavailable, '当前站点页数：2');
});
