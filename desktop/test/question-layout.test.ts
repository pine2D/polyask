import assert from 'node:assert/strict';
import test from 'node:test';
import { historyPanelWidth, coverSitesForHistory } from '../src/main/question-layout';
test('history reserves space only when the remaining site viewport is usable', () => {
  assert.equal(historyPanelWidth(1200, true), 360);
  assert.equal(historyPanelWidth(600, true), 0);
  assert.equal(historyPanelWidth(1200, false), 0);
});
test('full history hides attached site views without changing their bounds', () => {
  const visibility: boolean[] = [];
  const site = { webContents: { id: 2 }, setVisible: (value: boolean) => visibility.push(value) };
  const window = { webContents: { id: 1 }, contentView: { children: [site] } };
  coverSitesForHistory(window as never, true);
  coverSitesForHistory(window as never, false);
  assert.deepEqual(visibility, [false, true]);
});
