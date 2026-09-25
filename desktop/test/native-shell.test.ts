import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { shellBackground, bindShellTheme, shellContextMenu } from '../src/main/native-shell-policy';
import { applicationMenu } from '../src/main/application-menu';
import { COPY } from '../src/shared/copy';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/shared/display';

test('window background tracks theme and unsubscribes on close', () => {
  const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: true });
  const colors: string[] = [];
  const win = Object.assign(new EventEmitter(), { setBackgroundColor: (color: string) => colors.push(color) });
  assert.equal(shellBackground(theme), '#17171c');
  bindShellTheme(win, theme);
  theme.shouldUseDarkColors = false;
  theme.emit('updated');
  assert.deepEqual(colors, ['#17171c', '#f4f5f8']);
  win.emit('closed');
  assert.equal(theme.listenerCount('updated'), 0);
});

test('native editing menu respects selection and edit capabilities', () => {
  const editFlags = { canUndo: false, canRedo: true, canCut: false, canCopy: true, canPaste: true, canSelectAll: true };
  const editable = shellContextMenu({ isEditable: true, selectionText: '', editFlags });
  assert.equal(editable.find(item => item.role === 'cut')?.enabled, false);
  assert.equal(editable.find(item => item.role === 'paste')?.enabled, true);
  assert.deepEqual(shellContextMenu({ isEditable: false, selectionText: 'Answer', editFlags }).map(item => item.role), ['copy']);
  assert.deepEqual(shellContextMenu({ isEditable: false, selectionText: '', editFlags }), []);
});

test('Mac application menu exposes settings once and native lifecycle roles', () => {
  for (const platform of ['darwin', 'win32', 'linux'] as const) {
    const called: string[] = [];
    const menu = applicationMenu(platform, COPY.en, DEFAULT_DISPLAY_PREFERENCES, () => {}, id => called.push(id), 'PolyAsk');
    const flatten = (items: typeof menu): typeof menu => items.flatMap(item => [item, ...flatten(Array.isArray(item.submenu) ? item.submenu : [])]);
    const items = flatten(menu);
    assert.equal(items.filter(item => item.accelerator === (platform === 'darwin' ? 'Command+,' : 'Control+,')).length, 1);
    if (platform === 'darwin') {
      for (const role of ['services', 'hide', 'hideOthers', 'unhide', 'front', 'zoom']) assert.ok(items.some(item => item.role === role), role);
      const settings = (menu[0].submenu as typeof menu).find(item => item.accelerator === 'Command+,');
      assert.ok(settings);
      settings.click?.({} as any, {} as any, {} as any);
      assert.deepEqual(called, ['open-settings']);
    } else assert.ok(!items.some(item => item.role === 'hide'));
  }
});
