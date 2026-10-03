const assert = require('node:assert/strict');
const test = require('node:test');
const { setup, node } = require('./lib/history-harness');

// 2026-10-03 元宝：生成中点「滚到底部」等控件曾把副本冻结在半句话。
test('page controls during a streaming bound answer do not truncate the copy', () => {
  const s = setup(), answer = node('in the lee of the');
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer, userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'in the lee of the');
  s.activate(); s.customActivate('pointer'); s.input();
  answer.text = 'in the lee of the hill';
  const result = s.S.history.snapshot('token');
  assert.equal(result.owned, true);
  assert.equal(result.ended, undefined);
  assert.equal(result.text, 'in the lee of the hill');
});

test('structural guards still end a streaming copy after a page control', () => {
  const s = setup();
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer: node('Partial'), userCount: 1 });
  s.activate();
  s.set({ user: node('Next'), text: 'Next', answer: node('Wrong'), userCount: 2 });
  assert.equal(s.S.history.snapshot('token').ended, true);
});

test('activation before the submitted turn binds still stops even while generating', () => {
  const s = setup(); s.navigate('https://example.test/');
  s.S.history.begin('token', 'Question');
  s.activate();
  s.insert({ user: node('Question'), text: 'Question', answer: node('Old'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});

test('recent growth inside the bound answer counts as streaming when the stop control is hidden', () => {
  const s = setup(), child = {}, answer = node('Partial');
  answer.contains = target => target === child;
  s.S.adapters['example.test'].generation = () => 'complete';
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer, userCount: 1 });
  s.S.history.snapshot('token');
  s.mutate([{ target: child, addedNodes: [] }]);
  s.input(); s.activate();
  answer.text = 'Partial and more';
  assert.equal(s.S.history.snapshot('token').text, 'Partial and more');
  s.advance(2_000); s.activate();
  answer.text = 'Regenerated';
  assert.equal(s.S.history.snapshot('token').text, 'Partial and more');
  assert.equal(s.S.history.snapshot('token').ended, true);
});
