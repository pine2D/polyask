import assert from "node:assert/strict";
import test from "node:test";
import type { WebContents } from "electron";
import { SiteCommandChannel } from "../src/main/site-command-channel";
import type { SiteCommandEnvelope, SubmitSiteCommand } from "../src/shared/protocol";

const command = (): SubmitSiteCommand => ({
  source: "AMS", cmd: "submitPrompt", text: "fixture", tier: "think", images: [], deadline: Date.now() + 5000
});

test("取消先终止站点执行上下文，迟到的切档及发送回包不能恢复任务", async () => {
  const channel = new SiteCommandChannel(), controller = new AbortController();
  const events: string[] = [];
  let envelope: SiteCommandEnvelope | undefined;
  const contents = { id: 7, send(_name: string, value: SiteCommandEnvelope) { envelope = value; events.push("dispatch"); } } as WebContents;
  const pending = channel.send(contents, command(), {
    timeoutResult: { ok: false, code: "submit_unconfirmed" }, signal: controller.signal,
    onAbort: () => { events.push("destroy-context"); }
  }).then(result => { events.push("settled"); return result; });
  controller.abort();
  assert.deepEqual(await pending, { ok: false, code: "cancelled" });
  assert.deepEqual(events, ["dispatch", "destroy-context", "settled"]);
  assert.ok(envelope);
  channel.receive(contents, { requestId: envelope.requestId, result: {
    ok: true, selection: { requested: "think", outcome: "mode_only", observed: "think" }
  } });
  assert.deepEqual(await pending, { ok: false, code: "cancelled" });
  channel.dispose();
});

test("排队期间已取消的任务不向站点发送任何动作", async () => {
  const channel = new SiteCommandChannel(), controller = new AbortController();
  controller.abort();
  let calls = 0;
  const contents = { id: 8, send() { calls++; } } as unknown as WebContents;
  assert.deepEqual(await channel.send(contents, command(), {
    timeoutResult: { ok: false, code: "submit_unconfirmed" }, signal: controller.signal
  }), { ok: false, code: "cancelled" });
  assert.equal(calls, 0);
  channel.dispose();
});
