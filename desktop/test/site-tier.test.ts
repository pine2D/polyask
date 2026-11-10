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

test('custom tier requires an exact receipt for model and effort, not only a coarse mode', async () => {
  const preset = { model: 'Fable 5.2', effort: 'Extra' }, channel = new SiteCommandChannel();
  let sent: SiteCommandEnvelope | undefined;
  const contents = { id: 192, isDestroyed: () => false, getURL: () => 'https://claude.ai/new',
    send: (_key: string, envelope: SiteCommandEnvelope) => { sent = envelope; } };
  try {
    for (const model of [undefined, 'Fable 5.2 · Max', 'Fable 5.2 · Extra']) {
      const pending = switchSiteTier('claude', { webContents: contents } as any, null, false, channel, 'fast', Date.now() + 1000, preset);
      assert.ok(sent); assert.deepEqual('preset' in sent.command && sent.command.preset, preset);
      channel.receive(contents as any, { requestId: sent.requestId, result: { ok: true, selection: {
        requested: 'fast', observed: 'fast', ...(model ? { outcome: 'preferred', model } : { outcome: 'mode_only' })
      } as any } });
      assert.equal((await pending).ok, model === 'Fable 5.2 · Extra');
    }
  } finally { channel.dispose(); }
});
