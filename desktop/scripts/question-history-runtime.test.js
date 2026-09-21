const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup(host = "example.test") {
  let turn = null, mutated = () => {}, now = 1000;
  const listeners = new Map();
  const events = { addEventListener: (name, f) => listeners.set(name, f), removeEventListener: name => listeners.delete(name) };
  const adapter = { historyTurn: () => turn, generation: () => "generating" };
  const S = { adapters: { [host]: adapter }, toMarkdown: node => node.text };
  const context = { URL, getComputedStyle: node => ({ cursor: node.cursor || "auto" }), Date: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {}, document: { ...events, documentElement: {} }, MutationObserver: class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} }, window: { ...events, __AMS: S }, location: { hostname: host, href: `https://${host}/chat/one` } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/site-runtime/history.js"), "utf8"), context);
  return { S, customActivate: cursor => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ nodeType: 1, cursor, matches: () => false }] }), activate: () => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ matches: () => true }] }),
    input: () => listeners.get('beforeinput')?.({type:'beforeinput',isTrusted:true}), navigate: href => { context.location.href = href; }, popstate: () => listeners.get('popstate')?.({}), advance: ms => { now += ms; }, set: value => { turn = value; }, insert: value => { turn = value; mutated([{ addedNodes: [value.user] }]); } };
}
const node = (text) => ({ text, isConnected: true });
test("history capture refuses old answers and binds only a new matching user turn", () => {
  const s = setup(), oldUser = node("Question"), oldAnswer = node("Old");
  s.set({ user: oldUser, answer: oldAnswer, text: "Question", userCount: 1 });
  s.S.history.begin("token", "Question");
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set({ user: node("Question"), answer: node("New"), text: "Question", userCount: 2 });
  const result = s.S.history.snapshot("token");
  assert.equal(result.owned, true);
  assert.equal(result.text, "New");
  assert.equal(s.S.history.snapshot("other").owned, false);
});
test("detached baseline and later manual follow-ups fail closed", () => {
  const s = setup(), baseline = node("Earlier");
  s.set({ user: baseline, answer: node("Old"), text: "Earlier", userCount: 1 });
  s.S.history.begin("token", "Question");
  baseline.isConnected = false;
  s.set({ user: node("Question"), answer: node("Wrong"), text: "Question", userCount: 2 });
  assert.equal(s.S.history.snapshot("token").owned, false);
  s.set(null); s.S.history.begin("second", "Question");
  const user = node("Question");
  s.insert({ user, answer: node("Right"), text: "Question", userCount: 1 });
  assert.equal(s.S.history.snapshot("second").text, "Right");
  s.set({ user: node("Next"), answer: node("Wrong"), text: "Next", userCount: 2 });
  assert.equal(s.S.history.snapshot("second").ended, true);
});
test('an empty baseline without an observed new user insertion cannot bind an old matching turn', () => {
  const s = setup();
  s.S.history.begin('token', 'Question');
  s.set({ user: node('Question'), answer: node('Old'), text: 'Question', userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('a same-text manual follow-up before the first poll is not the submitted turn', () => {
  const s = setup();
  s.set({ user: node('Earlier'), text: 'Earlier', userCount: 1 });
  s.S.history.begin('token', 'Question');
  s.set({ user: node('Question'), text: 'Question', answer: node('Manual follow-up'), userCount: 3 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('a trusted regeneration activation freezes the last safe answer before DOM replacement', () => {
  const s = setup();
  s.set({ user: node('Earlier'), text: 'Earlier', userCount: 1 });
  s.S.adapters['example.test'].generation = () => 'complete';
  s.S.history.begin('token', 'Question');
  const answer = node('Original');
  s.set({ user: node('Question'), text: 'Question', answer, userCount: 2 });
  assert.equal(s.S.history.snapshot('token').text, 'Original');
  s.activate();
  answer.text = 'Regenerated';
  assert.equal(s.S.history.snapshot('token').text, 'Original');
  assert.equal(s.S.history.snapshot('token').ended, true);
});

test('heuristic completion during streaming does not freeze the first token', () => {
  const s = setup();
  s.S.adapters['example.test'].generation = () => 'complete';
  s.S.history.begin('token', 'Question');
  const answer = node('');
  s.insert({ user: node('Question'), text: 'Question', answer, userCount: 1 });
  answer.text = 'First';
  assert.equal(s.S.history.snapshot('token').text, 'First');
  s.advance(5000); answer.text = 'First and rest';
  const next = s.S.history.snapshot('token');
  assert.equal(next.owned, true);
  assert.equal(next.text, 'First and rest');
  assert.notEqual(next.generation, 'complete');
});
test('streaming may replace markdown children inside the same owned answer container', () => {
  const s = setup(), root = node('Container'), u = node('Question');
  s.S.history.begin('token', 'Question');
  s.insert({ user: u, text: 'Question', answer: node('First'), answerRoot: root, userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'First');
  s.set({ user: u, text: 'Question', answer: node('Full answer'), answerRoot: root, userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'Full answer');
  s.set({ user: u, text: 'Question', answer: node('Other'), answerRoot: node('Other container'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('a detached optimistic user may remount before the first answer, without allowing an extra turn', () => {
  const s = setup(), optimistic = node('Question');
  s.S.history.begin('token', 'Question');
  s.insert({ user: optimistic, text: 'Question', userCount: 1 });
  optimistic.isConnected = false;
  s.set({ user: node('Question'), text: 'Question', answer: node('Server answer'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'Server answer');
  s.set({ user: node('Question'), text: 'Question', answer: node('Manual follow-up'), userCount: 2 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('empty answer skeleton does not lock the eventual answer container', () => {
  const s = setup(), u = node('Question');
  s.S.history.begin('token', 'Question');
  s.insert({ user: u, text: 'Question', answer: node(''), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, true);
  s.set({ user: u, text: 'Question', answer: node('Final text'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'Final text');
});
test('owned thinking phase reports generation before a markdown answer exists', () => {
  const s = setup();
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer: null, userCount: 1 });
  assert.equal(s.S.history.snapshot('token').generation, 'generating');
});

test('a long streaming pause never proves completion', () => {
  const s = setup(), answer = node('First');
  s.S.adapters['example.test'].generation = () => 'complete';
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer, userCount: 1 });
  s.S.history.snapshot('token'); s.advance(30_000);
  assert.notEqual(s.S.history.snapshot('token').generation, 'complete');
  answer.text = 'First and remaining stream';
  assert.equal(s.S.history.snapshot('token').text, 'First and remaining stream');
});
test('optimistic remount cannot adopt a same-text old conversation on another route', () => {
  const s = setup(), optimistic = node('Question');
  s.S.history.begin('token', 'Question');
  s.insert({ user: optimistic, text: 'Question', userCount: 1 });
  optimistic.isConnected = false;
  s.navigate('https://example.test/chat/old');
  s.set({ user: node('Question'), text: 'Question', answer: node('Old answer'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('history back ends an optimistic capture even before its initial conversation URL', () => {
  const s = setup(); s.navigate('https://example.test/');
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', userCount: 1 });
  s.popstate();
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('Yuanbao agent landing may acquire its first conversation segment', () => {
  const s = setup(); s.navigate('https://yuanbao.tencent.com/chat/abcdefghij');
  s.S.history.begin('token', 'Question');
  s.navigate('https://yuanbao.tencent.com/chat/abcdefghij/klmnopqrstu');
  s.insert({ user: node('Question'), text: 'Question', answer: node('New'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'New');
});
test('bootstrap conversation redirects cannot lock a route before the submitted turn exists', () => {
  const s = setup(); s.navigate('https://example.test/');
  s.S.history.begin('token', 'Question');
  s.navigate('https://example.test/chat/pending');
  assert.equal(s.S.history.snapshot('token').owned, false);
  s.navigate('https://example.test/chat/final');
  s.insert({ user: node('Question'), text: 'Question', answer: node('New answer'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'New answer');
});
test('user navigation before binding cannot adopt an old matching turn', () => {
  const s = setup(); s.navigate('https://example.test/');
  s.S.history.begin('token', 'Question');
  s.activate();
  s.navigate('https://example.test/chat/old');
  s.insert({ user: node('Question'), text: 'Question', answer: node('Old'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});

test('ChatGPT provisional WEB route may settle once to its server conversation', () => {
  const s = setup(); s.navigate('https://chatgpt.com/');
  s.S.history.begin('token', 'Question');
  s.navigate('https://chatgpt.com/c/WEB:01234567-89ab-cdef-0123-456789abcdef');
  const u = node('Question');
  s.insert({ user: u, text: 'Question', userCount: 1 });
  s.navigate('https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef');
  s.set({ user: u, text: 'Question', answer: node('New'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'New');
  s.navigate('https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('native composer injection before the user turn exists is not a manual follow-up', () => {
  const s = setup(); s.S.history.begin('token', 'Question');
  s.input();
  s.insert({ user: node('Question'), text: 'Question', answer: node('New'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').text, 'New');
});
test('history back before binding cannot adopt a same-text previous conversation', () => {
  const s = setup(); s.navigate('https://example.test/');
  s.S.history.begin('token', 'Question');
  s.navigate('https://example.test/chat/old'); s.popstate();
  s.insert({ user: node('Question'), text: 'Question', answer: node('Old'), userCount: 1 });
  assert.equal(s.S.history.snapshot('token').owned, false);
});

test('custom pointer controls freeze copies while ordinary text selection does not', () => {
  const s = setup(), answer = node('Original');
  s.S.history.begin('token', 'Question');
  s.insert({ user: node('Question'), text: 'Question', answer, userCount: 1 });
  s.S.history.snapshot('token');
  s.customActivate('text'); answer.text = 'Continued';
  assert.equal(s.S.history.snapshot('token').text, 'Continued');
  s.customActivate('pointer'); answer.text = 'Regenerated';
  assert.equal(s.S.history.snapshot('token').text, 'Continued');
  assert.equal(s.S.history.snapshot('token').ended, true);
});
test('Kimi first turn may migrate once before the answer with the identical connected user', () => {
  const s = setup('www.kimi.com'), user = node('Question');
  s.navigate('https://www.kimi.com/'); s.S.history.begin('token', 'Question');
  s.navigate('https://www.kimi.com/chat/temporary');
  s.insert({ user, text: 'Question', userCount: 1 });
  s.navigate('https://www.kimi.com/chat/server');
  s.set({ user, text: 'Question', answer: node('Correct'), userCount: 1 });
  const result = s.S.history.snapshot('token');
  assert.equal(result.text, 'Correct');
  assert.equal(result.url, 'https://www.kimi.com/chat/server');
  s.navigate('https://www.kimi.com/chat/other');
  assert.equal(s.S.history.snapshot('token').owned, false);
});
test('Kimi migration excludes existing conversations, detached turns and browser navigation', () => {
  for (const mode of ['existing', 'detached', 'popstate', 'second-migration', 'answered']) {
    const s = setup('www.kimi.com'), user = node('Question');
    if (mode !== 'existing') s.navigate('https://www.kimi.com/');
    s.S.history.begin('token', 'Question');
    s.navigate('https://www.kimi.com/chat/one');
    s.insert({ user, text: 'Question', userCount: 1 });
    if (mode === 'detached') user.isConnected = false;
    if (mode === 'popstate') s.popstate();
    if (mode === 'answered') {
      s.set({ user, text: 'Question', answer: node('Original'), userCount: 1 });
      s.S.history.snapshot('token');
    }
    s.navigate('https://www.kimi.com/chat/two');
    if (mode === 'second-migration') {
      s.S.history.snapshot('token'); s.navigate('https://www.kimi.com/chat/three');
    }
    s.set({ user: mode === 'detached' ? node('Question') : user, text: 'Question', answer: node('Wrong'), userCount: 1 });
    assert.equal(s.S.history.snapshot('token').owned, false, mode);
  }
});

test('Doubao virtualized baseline binds only an adjacent stable new user key', () => {
  const s = setup('doubao.com'), old = node('Earlier');
  s.set({user:old,userKey:'old',text:'Earlier',userCount:4});
  s.S.history.begin('token','Question'); old.isConnected=false;
  s.insert({user:node('Question'),userKey:'new',previousUserKey:'old',text:'Question',userCount:2,answer:node('Right')});
  assert.equal(s.S.history.snapshot('token').text,'Right');
  s.insert({user:node('Question'),userKey:'followup',previousUserKey:'new',text:'Question',userCount:2,answer:node('Wrong')});
  assert.equal(s.S.history.snapshot('token').owned,false);
});
test('Doubao virtualized adjacency never authorizes a different conversation', () => {
  const s=setup('doubao.com'), old=node('Earlier');
  s.set({user:old,userKey:'old',text:'Earlier',userCount:4});
  s.S.history.begin('token','Question');old.isConnected=false;
  s.navigate('https://doubao.com/chat/other');
  s.insert({user:node('Question'),userKey:'new',previousUserKey:'old',text:'Question',userCount:2,answer:node('Wrong')});
  assert.equal(s.S.history.snapshot('token').owned,false);
});
test('Doubao recycled baseline without matching predecessor cannot bind', () => {
  for (const previousUserKey of [undefined, 'other']) {
    const s=setup('doubao.com'), old=node('Earlier');
    s.set({user:old,userKey:'old',text:'Earlier',userCount:4});
    s.S.history.begin('token','Question');old.isConnected=false;
    s.insert({user:node('Question'),userKey:'new',previousUserKey,text:'Question',userCount:2,answer:node('Wrong')});
    assert.equal(s.S.history.snapshot('token').owned,false);
  }
});
