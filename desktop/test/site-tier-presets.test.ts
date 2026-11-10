import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { inspectSitePreset } from '../src/main/site-tier-presets';
import { SiteCommandChannel } from '../src/main/site-command-channel';
import type { SiteCommandEnvelope } from '../src/shared/protocol';
const current = { model: 'Fable 5.2', effort: 'Medium' };
function setup() {
  const channel = new SiteCommandChannel(); let url = 'https://claude.ai/new', sent: SiteCommandEnvelope | undefined;
  const contents = Object.assign(new EventEmitter(), { id: 72, isDestroyed: () => false, getURL: () => url,
    send: (_name: string, value: SiteCommandEnvelope) => { sent = value; } });
  const invoke = (busy = false, navigating = false, deadline = Date.now() + 1000) =>
    inspectSitePreset('claude', { webContents: contents } as any, null, navigating, busy, channel, { kind: 'current' }, deadline);
  return { channel, contents, invoke, sent: () => sent, url: (next: string) => { url = next; },
    reply: (result: unknown) => { assert.ok(sent); channel.receive(contents as any, { requestId: sent.requestId, result: result as any }); } };
}

test('preset discovery rejects busy, unavailable and navigating pages without sending a command', async () => {
  const f = setup();
  try {
    assert.equal((await f.invoke(true)).ok, false); assert.equal((await f.invoke(false, true)).ok, false);
    f.url('https://chatgpt.com'); assert.equal((await f.invoke()).ok, false);
    f.url('https://accounts.google.com'); assert.equal((await f.invoke()).ok, false);
    assert.equal(f.sent(), undefined);
    f.url('https://claude.ai/new'); const pending = f.invoke(); assert.equal(f.sent()?.command.cmd, 'tierPreset');
    f.reply({ ok: true, current }); assert.equal((await pending).ok, true);
    assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
  } finally { f.channel.dispose(); }
});

test('same-URL navigation and late responses cannot confirm a preset operation', async () => {
  for (const late of [false, true]) {
    const f = setup();
    try {
      const pending = f.invoke(false, false, Date.now() + (late ? 10 : 1000));
      if (late) await new Promise(resolve => setTimeout(resolve, 20));
      else f.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
      f.reply({ ok: true, current }); assert.equal((await pending).ok, false);
      assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
    } finally { f.channel.dispose(); }
  }
});
