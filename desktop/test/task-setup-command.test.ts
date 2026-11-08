import test from 'node:test';
import assert from 'node:assert/strict';
import { commandById } from '../src/shared/commands';
import { MORE_MENU_IDS } from '../src/shared/more-menu';
import { getCopy } from '../src/shared/copy';

test('task preparation is discoverable in commands and the workspace more menu in all locales', () => {
  const command = commandById('open-task-setup');
  assert.equal(command?.group, 'compose');
  assert.equal(MORE_MENU_IDS.some(id => id === 'open-task-setup' as string), true);
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    assert.equal(typeof getCopy(locale)[command!.labelKey], 'string');
  }
});
