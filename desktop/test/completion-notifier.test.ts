import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { CompletionNotifier } from '../src/main/completion-notifier';
import type { SiteStatus } from '../src/shared/protocol';

function status(site: SiteStatus['site'], phase: SiteStatus['phase'], runId = 'run-a'): SiteStatus {
  return { site, phase, submission: { runId, state: phase === 'sending' ? 'sending' : phase === 'failed' ? 'failed' : 'sent' },
    ...(phase === 'complete' || phase === 'generating' ? { generation: { runId, state: phase } } : {}) };
}
function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown: { title: string; body: string; runId: string; sites: readonly string[] }[] = [];
  let focused = false;
  const notifier = new CompletionNotifier({ copy: { title: 'PolyAsk', complete: site => `${site} finished`,
    failed: site => `${site} needs attention`, summary: (complete, failed) => `Complete: ${complete}; attention: ${failed}` },
    focused: () => focused, show: value => { shown.push(value); } });
  return { notifier, shown, focus: () => { focused = true; }, flush: () => t.mock.timers.tick(1_000) };
}

test('nearby terminal events aggregate by run while unknown generation stays silent', t => {
  const h = fixture(t); h.notifier.setEnabled(true);
  h.notifier.accept(status('claude', 'complete'), 'Claude');
  h.notifier.accept(status('chatgpt', 'failed'), 'ChatGPT');
  h.notifier.accept({ ...status('gemini', 'warning'), code: 'generation_unconfirmed' }, 'Gemini');
  h.notifier.accept(status('kimi', 'complete', 'run-b'), 'Kimi');
  assert.equal(h.shown.length, 0);
  h.flush();
  assert.deepEqual(h.shown.map(v => [v.body, v.runId, v.sites]), [
    ['Complete: 1; attention: 1', 'run-a', ['claude', 'chatgpt']], ['Kimi finished', 'run-b', ['kimi']]
  ]);
  h.notifier.dispose();
});

test('retry invalidates pending failures and permits one fresh terminal notification', t => {
  const h = fixture(t); h.notifier.setEnabled(true);
  h.notifier.accept(status('claude', 'failed'), 'Claude');
  h.notifier.accept(status('claude', 'sending'), 'Claude');
  h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.accept(status('claude', 'failed'), 'Claude'); h.flush();
  h.notifier.accept(status('claude', 'failed'), 'Claude'); h.flush();
  assert.equal(h.shown.length, 1);
  h.notifier.accept(status('claude', 'sending'), 'Claude');
  h.notifier.accept(status('claude', 'complete'), 'Claude'); h.flush();
  assert.equal(h.shown.length, 2);
  h.notifier.dispose();
});

test('disabled, foreground, superseded and disposed batches never leak a delayed notification', t => {
  const h = fixture(t);
  h.notifier.accept(status('claude', 'complete'), 'Claude'); h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.setEnabled(true);
  h.notifier.accept(status('claude', 'sending', 'run-b'), 'Claude');
  h.notifier.accept(status('claude', 'complete', 'run-b'), 'Claude');
  h.notifier.setEnabled(false); h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.setEnabled(true);
  h.notifier.accept(status('claude', 'complete', 'run-c'), 'Claude');
  h.notifier.accept(status('claude', 'sending', 'run-d'), 'Claude'); h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.accept(status('claude', 'complete', 'run-c'), 'Claude'); h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.accept(status('claude', 'complete', 'run-d'), 'Claude'); h.focus(); h.flush(); assert.equal(h.shown.length, 0);
  h.notifier.accept(status('kimi', 'complete'), 'Kimi'); h.notifier.dispose(); h.flush(); assert.equal(h.shown.length, 0);
});

test('completion needs positive generation evidence and ignores badge visibility', t => {
  const h = fixture(t); h.notifier.setEnabled(true);
  h.notifier.accept({ site: 'claude', phase: 'complete' }, 'Claude');
  h.notifier.accept({ ...status('chatgpt', 'complete'), generation: { runId: 'old-run', state: 'complete' } }, 'ChatGPT');
  h.notifier.accept({ ...status('kimi', 'complete'), unread: false }, 'Kimi'); h.flush();
  assert.equal(h.shown.length, 1); assert.equal(h.shown[0].body, 'Kimi finished'); h.notifier.dispose();
});
