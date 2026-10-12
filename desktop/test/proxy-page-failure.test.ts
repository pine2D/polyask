import assert from "node:assert/strict";
import test from "node:test";

import { viewManagerHarness } from "./view-manager-harness";

const submit = { source: "AMS", cmd: "submitPrompt", text: "q", tier: null, deadline: Date.now() + 44_000, images: [] } as const;
// view-manager 在 harness 的独立 realm 里加载，返回对象原型不同；比较前按 JSON 归一。
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const plain = (h: ReturnType<typeof viewManagerHarness>, site: string) => {
  const status = h.status(site);
  return { phase: status.phase, code: status.code ?? null };
};

// spec §5.1：代理失败要让用户去查代理，而不是以为站点挂了；命令照旧不派发（不能落到 submit_unconfirmed）。
test("a main-frame proxy failure is stored as its proxy code and returned by send and collect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness({ sites: ["claude"] });
  try {
    const claude = h.views[0];
    const cases: readonly (readonly [number, string])[] = [
      [-130, "proxy_failed"], [-111, "proxy_failed"], [-120, "proxy_failed"], [-121, "proxy_failed"],
      [-131, "proxy_failed"], [-136, "proxy_failed"], [-127, "proxy_auth_failed"], [-115, "proxy_auth_failed"],
      [-105, "load_failed"], [-118, "load_failed"], [-106, "load_failed"]
    ];
    for (const [errno, code] of cases) {
      claude.callbacks.onLoading();
      assert.deepEqual(plain(h, "claude"), { phase: "loading", code: null }, `${errno}: a new load clears the stored code`);
      claude.callbacks.onFailure(errno);
      assert.deepEqual(plain(h, "claude"), { phase: "failed", code }, String(errno));
      assert.deepEqual(json(await h.manager.sendCommand("claude", submit, new AbortController().signal)), { ok: false, code }, `${errno} send`);
      assert.deepEqual(json(await h.manager.collect("claude", Date.now() + 1_000)), { code }, `${errno} collect`);
    }
    assert.equal(claude.calls.includes("send"), false, "a failed page is never sent a command");
    claude.callbacks.onReady();
    assert.deepEqual(plain(h, "claude"), { phase: "ready", code: null }, "a later successful load clears the proxy code");
  } finally { h.window.emit("closed"); }
});

test("a crash still wins over a stored proxy code", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = viewManagerHarness({ sites: ["claude"] });
  try {
    const claude = h.views[0];
    claude.callbacks.onFailure(-130);
    claude.callbacks.onCrash("crashed");
    assert.deepEqual(plain(h, "claude"), { phase: "crashed", code: "renderer_crashed" });
    assert.deepEqual(json(await h.manager.sendCommand("claude", submit, new AbortController().signal)), { ok: false, code: "renderer_crashed" });
  } finally { h.window.emit("closed"); }
});
