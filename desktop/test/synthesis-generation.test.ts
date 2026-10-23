import assert from "node:assert/strict";
import test from "node:test";
import { sendTrackedSynthesis } from "../src/main/synthesis-generation";
import { BroadcastCoordinator } from "../src/main/broadcast";
import type { ViewManager } from "../src/main/view-manager";
import { buildSynthesisPrompt } from '../src/shared/synthesis';
import { archiveFixture } from './fixtures';
import { CompletionNotifier } from '../src/main/completion-notifier';
const { replayHtml } = require('../scripts/lib/dom-replay');

test('failed assisted sends notify once for their own run without changing broadcast counters', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notices: string[] = [], statuses: any[] = [];
  let runId = '';
  const notifier = new CompletionNotifier({ copy: { title: 'PolyAsk', complete: site => site, failed: site => site },
    focused: () => false, show: notice => notices.push(notice.runId) });
  notifier.setEnabled(true);
  const manager = {
    beginGenerationRun: (id: string) => { runId = id; },
    markStatus: (status: any) => { statuses.push(status); notifier.accept(status, 'Kimi'); },
    sendCommand: async () => ({ ok: false, code: 'inject_failed' }),
    confirmSubmitted: async () => null,
    watchGeneration: () => assert.fail('failed sends cannot start generation monitoring')
  } as unknown as ViewManager;
  try {
    const [result] = await sendTrackedSynthesis({ sites: ['kimi'], text: 'Synthetic', tier: null, images: [] }, manager, new BroadcastCoordinator(), 44_000);
    assert.equal(result.ok, false);
    t.mock.timers.tick(1_000);
    assert.deepEqual(notices, [runId]);
    notifier.accept(statuses.at(-1), 'Kimi'); t.mock.timers.tick(1_000);
    assert.equal(notices.length, 1);
    assert.equal(statuses.every(status => status.submission === undefined), true);
  } finally { notifier.dispose(); }
});

test("assisted sends start completion monitoring without adding broadcast submission metadata", async () => {
  const events: any[] = [];
  const manager = {
    beginGenerationRun: (...args: any[]) => events.push(["begin", ...args]),
    markStatus: (status: any) => events.push(["status", status]),
    sendCommand: async () => ({ ok: true }),
    confirmSubmitted: async () => null,
    watchGeneration: (...args: any[]) => events.push(["watch", ...args])
  } as unknown as ViewManager;
  const results = await sendTrackedSynthesis({ sites: ["kimi"], text: "Synthetic", tier: null, images: [] }, manager, new BroadcastCoordinator(), 44_000);
  assert.equal(results[0].ok, true);
  assert.equal(events[0][0], "begin");
  assert.equal(events[0][3], false, "must not clear broadcast submission counters");
  assert.equal(events.at(-1)[0], "watch");
  assert.equal(events.at(-1)[1], events[0][1]);
  for (const event of events.filter(e => e[0] === "status")) assert.equal(event[1].submission, undefined);
});

for (const formatted of [false, true]) test(`assisted Doubao sends confirm their own keyed turn (formatted=${formatted})`, async t => {
  const h = replayHtml('<main><section></section><textarea></textarea><button id="flow-end-msg-send">Send</button></main>',
    { host: 'www.doubao.com', path: '/chat/12345678901234567' });
  t.after(h.close);
  h.window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 100, right: 500, top: 450, bottom: 500, width: 400, height: 50 });
  let now = Date.now(), clicks = 0;
  h.window.Date.now = () => now;
  h.window.setTimeout = (fn: () => void, ms: number) => { if (ms > 10000) return 1; now += ms; queueMicrotask(fn); return 1; };
  h.window.clearTimeout = () => {};
  h.S.armGeneration = () => {};
  const answer = h.document.createElement('p'); answer.textContent = 'a_i and b_j';
  const record = archiveFixture();
  const text = formatted ? buildSynthesisPrompt({ record: { ...record,
    results: record.results.map(r => r.host === 'claude.ai' ? { ...r, text: h.S.toMarkdown(answer) } : r)
  }, selectedHosts: ['claude.ai'], instruction: 'Give a short answer.' }) : 'Question';
  const body = formatted ? new (require('markdown-it'))().render(text) : text;
  h.document.querySelector('button').onclick = () => {
    clicks++; h.document.querySelector('textarea').value = '';
    h.document.querySelector('section').insertAdjacentHTML('beforeend', `<div data-testid="union_message" data-target-id="reused">
      <div data-message-role="user" data-message-id="accepted-${clicks}"><div data-testid="message_text_content">${body}</div></div></div>`);
  };
  let watches = 0;
  const manager = { beginGenerationRun() {}, markStatus() {},
    sendCommand: (_site: string, command: object) => h.send(command),
    confirmSubmitted: async () => ({ supported: false, ok: false }), watchGeneration: () => { watches++; }
  } as unknown as ViewManager;
  for (let turn = 1; turn <= 2; turn++) {
    const [result] = await sendTrackedSynthesis({ sites: ['doubao'], text, tier: null, images: [] },
      manager, new BroadcastCoordinator(), 6000);
    assert.equal(result.ok, true, 'a newly accepted user turn must confirm auxiliary sends');
    assert.equal(result.submissionEvidence, 'message');
    assert.equal(clicks, turn, 'each auxiliary send clicks exactly once');
    assert.equal(watches, turn);
  }
});
