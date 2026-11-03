import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebContentsView } from 'electron';
import type { SiteCommandEnvelope } from '../src/shared/protocol';
import { SiteCommandChannel } from '../src/main/site-command-channel';
import { switchSiteTier } from '../src/main/site-tier';

function fixture() {
  const channel = new SiteCommandChannel();
  let url = 'https://claude.ai/new', destroyed = false, envelope: SiteCommandEnvelope | undefined;
  const contents = { id: 91, isDestroyed: () => destroyed, getURL: () => url,
    send(_name: string, value: SiteCommandEnvelope) { envelope = value; } };
  const view = { webContents: contents } as unknown as WebContentsView;
  const change = (failure: string | null = null, navigating = false, deadline = Date.now() + 1000) =>
    switchSiteTier('claude', view, failure, navigating, channel, 'think', deadline);
  return { channel, change, sent: () => envelope?.command,
    url: (value: string) => { url = value; }, destroy: () => { destroyed = true; },
    reply(result: any) { assert.ok(envelope); channel.receive(contents as any, { requestId: envelope.requestId, result }); } };
}

test('site tier refuses unavailable pages and never dispatches submitPrompt', async () => {
  const f = fixture();
  try {
    assert.equal((await f.change('renderer_crashed')).code, 'renderer_crashed');
    assert.equal((await f.change(null, true)).code, 'not_ready');
    f.url('https://accounts.google.com/');
    assert.equal((await f.change()).code, 'not_ready');
    assert.equal(f.sent(), undefined);
    f.url('https://claude.ai/new');
    const pending = f.change();
    assert.equal(f.sent()?.cmd, 'setTier');
    f.reply({ ok: true, selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } });
    assert.equal((await pending).ok, true);
  } finally { f.channel.dispose(); }
});

test('site tier rejects missing, mismatched, destroyed and stale navigation receipts', async () => {
  for (const receipt of [{ ok: true }, { ok: true, selection: { requested: 'fast', outcome: 'mode_only', observed: 'fast' } },
    { ok: false, code: 'composer_not_found' }, { state: 'think' }]) {
    const f = fixture();
    try { const pending = f.change(); f.reply(receipt); assert.equal((await pending).ok, false); }
    finally { f.channel.dispose(); }
  }
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.destroy(),
    (f: ReturnType<typeof fixture>) => f.url('https://claude.ai/chat/other')]) {
    const f = fixture();
    try {
      const pending = f.change(); mutate(f);
      f.reply({ ok: true, selection: { requested: 'think', outcome: 'mode_only', observed: 'think' } });
      assert.equal((await pending).ok, false);
    } finally { f.channel.dispose(); }
  }
});

test('site tier timeout is certain non-submission and deadline is not extended', async () => {
  const f = fixture();
  try {
    assert.equal((await f.change(null, false, Date.now() - 1)).code, 'timeout');
    assert.equal(f.sent(), undefined);
    assert.equal((await f.change(null, false, Date.now() + 10)).code, 'timeout');
  } finally { f.channel.dispose(); }
});
