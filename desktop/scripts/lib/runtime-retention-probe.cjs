// Tiny synthetic nodes isolate runtime ownership from browser/DOM-library caches.
// Run in a child with --expose-gc; never add a test-only cleanup hook to __AMS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function environment(host, files) {
  let turn = null, answer = null, root = null, shown = false, broken = false, now = 1000, serial = 0;
  const timers = new Map(), observers = new Set();
  function events() {
    const listeners = new Map();
    return {
      addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
      removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
      emit(name, event = {}) { for (const fn of [...(listeners.get(name) || [])]) fn(event); },
      count() { return [...listeners.values()].reduce((n, values) => n + values.size, 0); }
    };
  }
  const documentEvents = events(), windowEvents = events();
  const adapter = { answer: () => answer, historyTurn(ctx) {
    if (broken) throw new Error('synthetic locator failure');
    if (turn?.locate === 'anchor') ctx.cache = { user: turn.user };
    return turn;
  } };
  const S = { adapters: { [host]: adapter }, toMarkdown: node => node.text, findComposer: () => null };
  const stop = { getBoundingClientRect: () => ({ width: 40, height: 40, top: 500, bottom: 540, left: 600, right: 640 }) };
  const context = {
    URL, innerHeight: 900, innerWidth: 1200, getComputedStyle: () => ({ cursor: 'auto' }),
    Date: { now: () => now },
    setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { ...documentEvents, documentElement: {}, querySelectorAll: selector =>
      selector === '[data-testid="assistant-message"]' ? (root ? [root] : []) : (shown ? [stop] : []) },
    window: { ...windowEvents, __AMS: S, navigation: { currentEntry: { key: 'slot-0' } } },
    location: { hostname: host, href: `https://${host}/chat/one` },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    }
  };
  for (const file of files) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/site-runtime', file), 'utf8'), context);
  return {
    S, adapter, setTurn(value) { turn = value; }, setAnswer(value) { answer = value; }, setRoot(value) { root = value; },
    show(value) { shown = value; }, breakLocator() { broken = true; },
    mutate(records = []) { for (const observer of [...observers]) observer.callback(records); },
    navigate() { windowEvents.emit('popstate'); },
    activate() { documentEvents.emit('pointerdown', { type: 'pointerdown', isTrusted: true, composedPath: () => [{ matches: () => true }] }); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    count() { return documentEvents.count() + windowEvents.count() + timers.size + observers.size; }
  };
}
const node = text => ({ text, isConnected: true, contains(other) { return this === other; } });

function historyCase(kind) {
  const env = environment('example.test', ['history-route.js', 'history.js']);
  env.adapter.generation = () => 'complete';
  const previous = node('Earlier'), user = node('Synthetic question'), answer = node('Synthetic answer'), root = node('Wrapper');
  const refs = [previous, user, answer, root].map(value => new WeakRef(value));
  env.setTurn({ user: previous, answer: null, text: 'Earlier', userCount: 1 });
  env.S.history.begin('run', 'Synthetic question', 1000);
  env.setTurn({ user, answer, answerRoot: root, text: user.text, userCount: 2, locate: kind === 'anchor' ? 'anchor' : 'selector' });
  env.mutate([{ target: root, addedNodes: [user, root] }]);
  env.S.history.snapshot('run');
  // Let the streaming grace period elapse before a trusted manual action.
  env.advance(4000);
  if (kind === 'navigate') env.navigate();
  else if (kind === 'expire') env.advance(16 * 60_000);
  else if (kind === 'error') { env.breakLocator(); env.mutate(); }
  else env.activate();
  for (const value of [previous, user, answer, root]) value.isConnected = false;
  env.setTurn(null);
  const snapshot = env.S.history.snapshot('run');
  assert.equal(snapshot.ended, true);
  assert.equal(env.count(), 0, 'an ended capture must remove observers, timers and listeners');
  assert.equal(snapshot.captureCode, ({ navigate: 'route_changed', expire: 'capture_expired', error: 'runtime_error' })[kind] || 'interaction');
  if (kind === 'freeze' || kind === 'anchor') {
    assert.equal(snapshot.owned, true);
    assert.equal(snapshot.text, 'Synthetic answer', 'the frozen copy must survive DOM cleanup');
    assert.equal(snapshot.generation, null, 'freezing must not invent completion evidence');
  }
  return { env, refs };
}

function generationCase(host, seen) {
  const env = environment(host, ['generation.js']);
  const previous = node('Earlier answer'), root = node('Earlier wrapper');
  const refs = [previous, root].map(value => new WeakRef(value));
  env.setAnswer(previous); env.setRoot(root); env.S.armGeneration();
  if (seen) { env.show(true); env.mutate(); env.show(false); }
  assert.equal(env.S.generationProbe(), 'complete', 'seeing Stop without a new answer must not confirm the old answer');
  previous.isConnected = root.isConnected = false;
  env.setAnswer(node('New answer')); env.setRoot(node('New wrapper'));
  assert.equal(env.S.generationProbe(), seen ? 'complete_observed' : 'complete');
  // ChatGPT never captures a Claude root; only its answer baseline is relevant.
  return { env, refs: host === 'claude.ai' ? refs : refs.slice(0, 1) };
}

function markdownRoot(failed = false) {
  return { nodeType: 1, tagName: 'P', className: '', getAttribute: () => null, matches: () => false,
    get childNodes() {
      if (failed) throw new Error('synthetic serialization failure');
      return [{ nodeType: 3, nodeValue: 'Synthetic answer' }];
    }
  };
}
function markdownCase(failed) {
  const env = environment('example.test', ['md-head.js', 'md.js']);
  const root = markdownRoot(failed);
  if (failed) assert.throws(() => env.S.toMarkdown(root), /synthetic serialization failure/);
  else assert.equal(env.S.toMarkdown(root), 'Synthetic answer');
  return { env, refs: [new WeakRef(root)] };
}

async function collect() {
  // WeakRef targets remain alive for the current job. Cross turns before each GC.
  for (let i = 0; i < 8; i++) { await new Promise(setImmediate); global.gc(); }
}
async function main() {
  assert.equal(typeof global.gc, 'function');
  const kind = process.argv[2];
  if (kind.startsWith('markdown-')) {
    const { env, refs } = markdownCase(kind.endsWith('-error'));
    await collect();
    assert.equal(refs[0].deref() === undefined, true, 'serialization must release its input on success and error');
    assert.equal(env.S.toMarkdown(markdownRoot()), 'Synthetic answer');
  } else if (kind.startsWith('history-')) {
    const { env, refs } = historyCase(kind.slice(8));
    await collect();
    assert.equal(refs.filter(ref => ref.deref() !== undefined).length, 0, 'ended history must release all detached nodes without another submission');
    assert.equal(env.S.history.snapshot('run').ended, true);
  } else {
    const { env, refs } = generationCase(kind.includes('claude') ? 'claude.ai' : 'chatgpt.com', kind.endsWith('-seen'));
    await collect();
    assert.equal(refs.every(ref => ref.deref() !== undefined), true, 'active generation evidence must retain its baselines');
    env.advance(16 * 60_000);
    await collect();
    assert.equal(refs.filter(ref => ref.deref() !== undefined).length, 0, 'expired generation must release baselines even after Stop disconnected sampling');
    assert.equal(env.count(), 0);
    assert.equal(env.S.generationProbe(), 'complete', 'expired evidence must not confirm a later answer');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
