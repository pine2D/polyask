const assert = require('node:assert/strict');
const test = require('node:test');
const { replayHtml } = require('./lib/dom-replay');
const markdown = new (require('markdown-it'))();
const prompt = '# Task\nSource [S1]: **test**\n\n- first\n- second\n\n```js\nconst pattern = "\\\\[x]";\n```';
const bubble = text => `<div data-testid="union_message"><div data-message-role="user" data-message-id="key">
  <div data-testid="message_text_content">${markdown.render(text)}</div></div></div>`;
const setup = t => {
  const h = replayHtml('<main><section></section><textarea></textarea></main>', { host: 'www.doubao.com', path: '/chat/12345678901234567' });
  t.after(h.close); return h;
};

test('formatted user text binds without changing the default escaped answer export', async t => {
  const h = setup(t);
  h.S.history.begin('token', prompt);
  h.document.querySelector('section').innerHTML = bubble(prompt);
  await Promise.resolve();
  assert.equal(h.S.history.submitted('token'), true);
  const body = h.document.querySelector('[data-testid="message_text_content"]');
  assert.equal(h.S.toMarkdown(body).includes('Source \\[S1\\]'), true, 'answer serialization still escapes literal text');
  body.querySelector('h1').textContent = 'Different task';
  assert.equal(h.S.history.submitted('token'), false, 'changed markup invalidates the cached comparison');
});

for (const changed of [prompt.replace('**test**', '**other**'), prompt.replace('[x]', '[y]')])
  test('formatted text cannot confirm substantive or code-literal differences', async t => {
    const h = setup(t);
    h.S.history.begin('token', prompt);
    h.document.querySelector('section').innerHTML = bubble(changed);
    await Promise.resolve();
    assert.equal(h.S.history.submitted('token'), false);
  });

test('an existing same formatted turn is never new submission evidence', t => {
  const h = setup(t);
  h.document.querySelector('section').innerHTML = bubble(prompt);
  h.S.history.begin('token', prompt);
  assert.equal(h.S.history.submitted('token'), false);
});

test('a different conversation with identical formatted text remains unowned', async t => {
  const h = setup(t);
  h.S.history.begin('token', prompt);
  h.window.history.pushState(null, '', '/chat/99999999999999999');
  h.document.querySelector('section').innerHTML = bubble(prompt);
  await Promise.resolve();
  assert.equal(h.S.history.submitted('token'), false);
});

test('captured escaped answer text still confirms after rendering in a new prompt', async t => {
  const h = setup(t), answer = h.document.createElement('p');
  answer.textContent = 'a_i and b_j';
  const captured = h.S.toMarkdown(answer), text = '# Task\n' + captured;
  assert.equal(captured, 'a\\_i and b\\_j');
  h.S.history.begin('token', text);
  h.document.querySelector('section').innerHTML = bubble(text);
  await Promise.resolve();
  assert.equal(h.S.history.submitted('token'), true);
});

for (const [expected, different] of [
  ['# Task\n**alpha**', '# Task\n\\*\\*alpha\\*\\*'],
  ['**alpha**', '\\*\\*alpha\\*\\*'],
  ['# Task\n**alpha**', '\\# Task\n**alpha**'],
  ['# Task\n```js\na  b\n```', '# Task\n```js\na b\n```']
]) test('literal punctuation, formatting and code spacing are distinct evidence', async t => {
  const h = setup(t);
  h.S.history.begin('token', expected);
  h.document.querySelector('section').innerHTML = bubble(different);
  await Promise.resolve();
  assert.equal(h.S.history.submitted('token'), false);
});
