import assert from 'node:assert/strict';
import test from 'node:test';
import { historyPanelWidth, raiseHistoryShell } from '../src/main/question-layout';
test('history reserves space only when the remaining site viewport is usable', () => {
  assert.equal(historyPanelWidth(1200, true), 360);
  assert.equal(historyPanelWidth(600, true), 0);
  assert.equal(historyPanelWidth(1200, false), 0);
});
test('full history raises the shell without detaching or resizing live site views', () => {
  const shell = { webContents: { id: 1 } }, site = { webContents: { id: 2 } };
  const raised: unknown[] = [];
  raiseHistoryShell({ webContents: shell.webContents, contentView: { children: [shell, site], addChildView: (view: unknown) => raised.push(view) } } as never);
  assert.deepEqual(raised, [shell]);
});
