const assert = require('node:assert/strict');
const test = require('node:test');
const { setup, node } = require('./lib/history-harness');
const prompt = '一台5800x+4080s电脑在POE2最低画质下只有30FPS，请区分CPU、GPU瓶颈。';
const rendered = '一台 5800x+4080s 电脑在 POE2 最低画质下只有 30FPS，请区分 CPU、GPU 瓶颈。';

test('Doubao typography spacing still binds the uniquely inserted submitted user turn', () => {
  const s = setup('www.doubao.com'), user = node(rendered), answer = node('Owned answer');
  s.S.history.begin('token', prompt);
  s.insert({ user, text: rendered, userCount: 1, userKey: 'new', answer, answerKey: 'reply' });
  assert.equal(s.S.history.submitted('token'), true);
  assert.equal(s.S.history.snapshot('token').text, 'Owned answer');
});

test('Doubao spacing around quotes next to Han still binds the submitted turn (2026-10-03)', () => {
  const quoted = '英文中有没有"in the lee of pines"的用法？';
  const shown = '英文中有没有 "in the lee of pines" 的用法？';
  const s = setup('www.doubao.com'), user = node(shown);
  s.S.history.begin('token', quoted);
  s.insert({ user, text: shown, userCount: 1, userKey: 'new', answer: node('Owned answer'), answerKey: 'reply' });
  assert.equal(s.S.history.submitted('token'), true);
  assert.equal(s.S.history.snapshot('token').text, 'Owned answer');
});

for (const text of [rendered.replace('30FPS', '60FPS'), rendered.replace('CPU、GPU', 'CPU GPU')]) {
  test(`Doubao substantive changes cannot be attributed: ${text}`, () => {
    const s = setup('doubao.com');
    s.S.history.begin('token', prompt);
    s.insert({ user: node(text), text, userCount: 1, answer: node('Wrong') });
    assert.equal(s.S.history.snapshot('token').owned, false);
  });
}

test('Doubao typography tolerance does not erase English word or numeric spacing', () => {
  for (const [submitted, displayed] of [['CPU GPU', 'CPUGPU'], ['1 2', '12']]) {
    const s = setup('doubao.com');
    s.S.history.begin('token', submitted);
    s.insert({ user: node(displayed), text: displayed, userCount: 1, answer: node('Wrong') });
    assert.equal(s.S.history.snapshot('token').owned, false);
  }
});

test('typography tolerance is limited to Doubao and still rejects extra user turns', () => {
  const other = setup('chatgpt.com');
  other.S.history.begin('token', prompt);
  other.insert({ user: node(rendered), text: rendered, userCount: 1, answer: node('Wrong') });
  assert.equal(other.S.history.snapshot('token').owned, false);
  const s = setup('doubao.com');
  s.S.history.begin('token', prompt);
  s.insert({ user: node(rendered), text: rendered, userCount: 2, answer: node('Follow-up') });
  assert.equal(s.S.history.snapshot('token').ended, true);
});

// 2026-10-04 Windows：豆包新会话先 push /chat/local_<16 位>，确认后 replace 成服务端 id；旧实现把归属锁在 local 路由上，
// replace 后判为换会话而结束采集，副本封存为 unavailable。
test('Doubao provisional local_ chat route settles to the server id without ending the capture', () => {
  const s = setup('www.doubao.com'), user = node('Question'), answer = node('Owned answer');
  s.navigate('https://www.doubao.com/chat/');
  s.S.history.begin('token', 'Question');
  s.navigate('https://www.doubao.com/chat/local_1234567890123456');
  s.insert({ user, text: 'Question', userCount: 1, userKey: 'new', answer, answerKey: 'reply' });
  assert.equal(s.S.history.snapshot('token').text, 'Owned answer');
  s.navigate('https://www.doubao.com/chat/38445259209793026', { replace: true });
  const settled = s.S.history.snapshot('token');
  assert.equal(settled.owned, true);
  assert.equal(settled.text, 'Owned answer');
  s.navigate('https://www.doubao.com/chat/40000000000000001');
  assert.equal(s.S.history.snapshot('token').ended, true);
});
