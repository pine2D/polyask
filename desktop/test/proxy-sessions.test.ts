import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

import { SITE_PARTITION } from "../src/main/diagnostics";
import { readSource } from "./fixtures";

type Named = { readonly name: string };

function load() {
  const requested: string[] = [];
  const partitions = new Map<string, Named>();
  const defaultSession: Named = { name: "<default>" };
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(transformSync(readSource("src/main/proxy-sessions.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports,
    require: (name: string) => {
      if (name === "./diagnostics") return { SITE_PARTITION };
      assert.equal(name, "electron");
      return { session: {
        fromPartition: (partition: string) => {
          requested.push(partition);
          if (!partitions.has(partition)) partitions.set(partition, { name: partition });
          return partitions.get(partition);
        },
        get defaultSession() { requested.push("<default>"); return defaultSession; }
      } };
    }
  });
  const exported = module.exports as {
    SITE_PARTITION: string; NET_PARTITION: string; PROBE_PARTITION: string;
    managedSessions(): Named[]; verifySessions(): Named[];
  };
  return { exported, requested };
}

test("proxy partitions: sites reuse the diagnostics partition, net and probe stay in memory", () => {
  const { exported, requested } = load();
  assert.equal(exported.SITE_PARTITION, "persist:polyask-sites");
  assert.equal(exported.NET_PARTITION, "polyask-net");
  assert.equal(exported.PROBE_PARTITION, "polyask-proxy-probe");
  assert.equal(exported.NET_PARTITION.startsWith("persist:"), false, "Drive payloads and Google cookies must not hit disk");
  assert.equal(exported.PROBE_PARTITION.startsWith("persist:"), false);
  assert.equal(requested.length, 0, "sessions are resolved lazily, after app ready");
});

test("managed exits are site, default and net in a fixed order; verification reads site and net", () => {
  const { exported, requested } = load();
  const managed = exported.managedSessions();
  // vm 上下文的数组原型与本 realm 不同，只比较字符串。
  assert.equal(managed.map(entry => entry.name).join(","), "persist:polyask-sites,<default>,polyask-net");
  const verify = exported.verifySessions();
  assert.equal(verify.map(entry => entry.name).join(","), "persist:polyask-sites,polyask-net");
  assert.equal(verify[0] === managed[0] && verify[1] === managed[2], true, "verification inspects the same session objects");
  assert.equal(requested.includes("polyask-proxy-probe"), false, "the probe session is never part of the global apply");
});
