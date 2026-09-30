const assert = require("node:assert/strict");
const test = require("node:test");
const { setup, node } = require("./lib/history-harness");
for (const prefix of ['local-chatgpt%3A', 'local-chatgpt:', 'WEB%3A']) {
  test(`ChatGPT provisional ${prefix} route keeps the first answer through server settlement`, () => {
    const s = setup('chatgpt.com'); s.navigate('https://chatgpt.com/');
    s.S.history.begin('token', 'Question');
    s.navigate(`https://chatgpt.com/c/${prefix}01234567-89ab-cdef-0123-456789abcdef`);
    const u = node('Question'), answer = node('First');
    s.insert({ user: u, text: 'Question', userCount: 1 });
    assert.equal(s.S.history.snapshot('token').owned, true);
    s.navigate('https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    s.set({ user: u, text: 'Question', answer, userCount: 1 });
    assert.equal(s.S.history.snapshot('token').text, 'First');
    answer.text = 'Full answer';
    assert.equal(s.S.history.snapshot('token').text, 'Full answer');
    s.navigate('https://chatgpt.com/c/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.equal(s.S.history.snapshot('token').owned, false);
  });
}
test('unknown ChatGPT colon routes and browser navigation still end capture', () => {
  for (const mode of ['unknown-prefix', 'popstate']) {
    const s = setup('chatgpt.com'), u = node('Question'); s.navigate('https://chatgpt.com/');
    s.S.history.begin('token', 'Question');
    s.navigate(`https://chatgpt.com/c/${mode === 'unknown-prefix' ? 'other' : 'local-chatgpt'}%3A01234567-89ab-cdef-0123-456789abcdef`);
    s.insert({ user: u, text: 'Question', userCount: 1 });
    if (mode === 'popstate') s.popstate();
    s.navigate('https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    s.set({ user: u, text: 'Question', answer: node('Wrong'), userCount: 1 });
    assert.equal(s.S.history.snapshot('token').owned, false, mode);
  }
});
