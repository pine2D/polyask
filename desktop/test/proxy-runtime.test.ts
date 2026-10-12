import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { OperationGate } from "../src/shared/operation-gate";
import { BLOCKING_PROXY_CONFIG, DEFAULT_PROXY_PREFERENCE, PROXY_CHECK_URL, type ProxyPreference } from "../src/shared/proxy-preference";
import { DesktopDatabase } from "../src/main/database";
import { ProxyAuth } from "../src/main/proxy-auth";
import {
  PROXY_ACCEPTED_KEY, PROXY_FOLLOWING_KEY, PROXY_OVERRIDE_KEY, PROXY_STATE_KEY, ProxyPreferenceStore,
  type ProxyInputs, type Tagged
} from "../src/main/proxy-preference-store";
import type { VersionedProxy } from "../src/main/proxy-target";
import {
  ProxyRuntime, linuxDesktopProxySource, type ProxyAuthPort, type ProxyRuntimeOptions, type ProxySession, type ProxyWebContents
} from "../src/main/proxy-runtime";
import { SecretFileStore, type TokenCrypto } from "../src/main/secret-file-store";

const P1: ProxyPreference = { version: 1, mode: "custom", scheme: "http", host: "proxy-a.example", port: 7890, bypass: [], username: "alice" };
const P2: ProxyPreference = { ...P1, host: "proxy-b.example" };
const SOCKS: ProxyPreference = { ...P1, scheme: "socks5", host: "::1", port: 1080, username: "" };
const SYSTEM: ProxyPreference = DEFAULT_PROXY_PREFERENCE;
const DIRECT: ProxyPreference = { ...SYSTEM, mode: "direct" };

const absent = { kind: "absent" } as const;
const invalid = { kind: "invalid" } as const;
const ok = <T>(value: T): Tagged<T> => ({ kind: "ok", value });
const inputs = (patch: Partial<ProxyInputs> = {}): ProxyInputs => ({ following: absent, override: absent, shared: absent, accepted: absent, ...patch });
const shared = (value: ProxyPreference, updatedAt = 500): VersionedProxy => ({ value, updatedAt, deviceId: "device-b" });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** 按 Chromium 的 PAC 风格把配置翻成 resolveProxy 结果；broken 中的出口返回 DIRECT，模拟配置没生效。 */
function chromiumResolve(config: Electron.ProxyConfig | null): string {
  if (!config || config.mode !== "fixed_servers") return "DIRECT";
  const match = /^(http|https|socks4|socks5):\/\/(.+)$/.exec(config.proxyRules ?? "");
  if (!match) return "DIRECT";
  return `${{ http: "PROXY", https: "HTTPS", socks4: "SOCKS", socks5: "SOCKS5" }[match[1] as "http"]} ${match[2]}`;
}

/** 替换 auth / store / secrets 三项为真实实现时用；其余（session、app、webContents、时钟）仍是桩。 */
type RealDeps = Pick<ProxyRuntimeOptions, "auth" | "store" | "secrets">;

function harness(options: { inputs?: ProxyInputs; secretsClear?: () => Promise<void>; real?: RealDeps } = {}) {
  const log: string[] = [];
  const broken = new Set<string>();
  const holds = new Map<string, Promise<void>>();
  let clock = 0;
  let current = options.inputs ?? inputs();
  const accepted: ProxyPreference[] = [];
  const describe = (config: Electron.ProxyConfig) => config.mode === "fixed_servers" ? `fixed(${config.proxyRules})` : String(config.mode);
  const session = (name: string): ProxySession & { config: Electron.ProxyConfig | null } => ({
    config: null,
    async setProxy(config) {
      log.push(`${name}.setProxy:${describe(config)}`);
      const hold = holds.get(name); if (hold) await hold;
      this.config = config;
    },
    async resolveProxy(url) {
      assert.equal(url, PROXY_CHECK_URL);
      return broken.has(name) ? "DIRECT" : chromiumResolve(this.config);
    },
    async clearAuthCache() { log.push(`${name}.clearAuthCache`); }
  });
  const site = session("site"), shell = session("default"), net = session("net");
  const app = { config: null as Electron.ProxyConfig | null, async setProxy(config: Electron.ProxyConfig) { log.push(`app.setProxy:${describe(config)}`); this.config = config; } };
  let gen = 0;
  let wipe = 0;
  const authListeners = new Set<() => void>();
  const auth: ProxyAuthPort & { gen(): number; basis: { applied: ProxyPreference | null; applying: ProxyPreference | null } } = {
    basis: { applied: null, applying: null },
    gen: () => gen,
    wipeEpoch: () => wipe,
    setBasis(basis) { this.basis = basis; log.push(`auth.basis:${basis.applied?.host || basis.applied?.mode || "-"}>${basis.applying?.host || basis.applying?.mode || "-"}`); },
    beginApply(target, credential, identityChanged) { gen++; log.push(`auth.beginApply:${credential === undefined ? "keep" : credential ?? "clear"}:${identityChanged}`); return { gen }; },
    restore() { gen++; log.push("auth.restore"); },
    resetBreaker() { log.push("auth.resetBreaker"); },
    beginWipe() { wipe++; gen++; log.push("auth.beginWipe"); },
    endWipe() { log.push("auth.endWipe"); },
    secretState: () => "none",
    onChange(listener) { authListeners.add(listener); return () => authListeners.delete(listener); }
  };
  const contents = [true, false].map(alive => ({ destroyed: !alive, policies: [] as string[],
    isDestroyed() { return this.destroyed; },
    setWebRTCIPHandlingPolicy(policy: string) { this.policies.push(policy); } }));
  let cleared = 0;
  const runtime = new ProxyRuntime({
    sessions: () => [site, shell, net], verifySessions: () => [site, net], app,
    auth: options.real?.auth ?? auth,
    store: options.real?.store ?? { read: () => current, setAccepted: value => { accepted.push(value); return true; } },
    secrets: options.real?.secrets ?? { clear: options.secretsClear ?? (async () => { cleared++; log.push("secrets.clear"); }) },
    webContents: () => contents as unknown as ProxyWebContents[],
    sleep: async ms => { clock += ms; await Promise.resolve(); },
    now: () => clock
  });
  return {
    runtime, log, broken, holds, auth, app, contents, accepted, site, shell, net, authListeners,
    setInputs: (next: ProxyInputs) => { current = next; },
    cleared: () => cleared, elapsed: () => clock,
    setProxyLog: () => log.filter(line => line.includes(".setProxy:"))
  };
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("translates system, direct and custom onto every managed exit, then app", async () => {
  const h = harness();
  assert.deepEqual(await h.runtime.applyNow(SYSTEM), { ok: true });
  assert.deepEqual(h.setProxyLog(), ["site.setProxy:system", "default.setProxy:system", "net.setProxy:system", "app.setProxy:system"]);
  h.log.length = 0;
  assert.deepEqual(await h.runtime.applyNow(DIRECT), { ok: true });
  assert.deepEqual(h.setProxyLog(), ["site.setProxy:direct", "default.setProxy:direct", "net.setProxy:direct", "app.setProxy:direct"]);
  h.log.length = 0;
  assert.deepEqual(await h.runtime.applyNow(SOCKS), { ok: true });
  assert.deepEqual(h.setProxyLog(), ["site", "default", "net", "app"].map(name => `${name}.setProxy:fixed(socks5://[::1]:1080)`));
  assert.equal(h.runtime.state().applied === SOCKS, true);
  assert.equal(h.runtime.state().appliedResult, "ok");
});

test("re-applying the same route skips setProxy; a username-only change still loads credentials, then clears auth caches", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  h.log.length = 0;
  assert.deepEqual(await h.runtime.applyNow(P1), { ok: true });
  assert.deepEqual(h.setProxyLog(), [], "idempotent apply skips steps 2 and 3");
  assert.equal(h.log.includes("site.clearAuthCache"), false, "same identity, no credential: auth caches untouched");
  const renamed = { ...P1, username: "bob" };
  assert.deepEqual(await h.runtime.applyNow(renamed), { ok: true });
  assert.deepEqual(h.setProxyLog(), [], "username is not part of the route");
  assert.deepEqual(h.log.slice(h.log.indexOf("auth.beginApply:keep:true")).slice(0, 5),
    ["auth.beginApply:keep:true", "site.clearAuthCache", "default.clearAuthCache", "net.clearAuthCache", "auth.resetBreaker"]);
  assert.equal(h.runtime.state().applied === renamed, true, "the auth basis follows the new identity");
});

test("identity change with a new password loads it before clearing auth caches, both before setProxy, with the target as applying", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  h.log.length = 0;
  const seenDuringSetProxy: (string | null)[] = [];
  const original = h.site.setProxy.bind(h.site);
  h.site.setProxy = async config => { seenDuringSetProxy.push(h.auth.basis.applying?.host ?? null); return original(config); };
  assert.deepEqual(await h.runtime.applyNow(P2, "new-secret"), { ok: true });
  const firstSet = h.log.findIndex(line => line.includes(".setProxy:"));
  assert.deepEqual(h.log.slice(0, firstSet), [
    "auth.basis:proxy-a.example>proxy-b.example",
    "auth.beginApply:new-secret:true",
    "site.clearAuthCache", "default.clearAuthCache", "net.clearAuthCache",
    "auth.resetBreaker"
  ], "a 407 racing the cache clear can only be answered with the new password");
  assert.deepEqual(seenDuringSetProxy, ["proxy-b.example"], "a 407 from the new proxy during the switch can be answered");
  assert.equal(h.log.at(-1), "auth.basis:proxy-b.example>-");
});

test("clearing only the password plants the tombstone first, then clears auth caches, without touching routes", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  h.log.length = 0;
  assert.deepEqual(await h.runtime.applyNow(P1, null), { ok: true });
  assert.deepEqual(h.log, [
    "auth.basis:proxy-a.example>proxy-a.example",
    "auth.beginApply:clear:false",
    "site.clearAuthCache", "default.clearAuthCache", "net.clearAuthCache",
    "auth.resetBreaker", "auth.basis:proxy-a.example>-"
  ], "the old password can no longer be handed out once the caches are being cleared");
});

test("concurrent applies run strictly one after another", async () => {
  const h = harness();
  const gate = deferred();
  h.holds.set("site", gate.promise);
  const first = h.runtime.applyNow(P1);
  const second = h.runtime.applyNow(P2);
  await settle();
  assert.deepEqual(h.setProxyLog(), ["site.setProxy:fixed(http://proxy-a.example:7890)"], "second apply waits for the first");
  h.holds.delete("site"); gate.resolve();
  assert.deepEqual([await first, await second], [{ ok: true }, { ok: true }]);
  const order = h.setProxyLog().map(line => line.includes("proxy-a") ? "a" : "b");
  assert.deepEqual(order, ["a", "a", "a", "a", "b", "b", "b", "b"]);
});

test("at startup a config that resolves but does not take effect blocks egress instead of going direct", async () => {
  const h = harness();
  h.broken.add("net");
  assert.deepEqual(await h.runtime.applyNow(P1), { ok: false, result: "proxy_apply_failed" });
  assert.equal(h.elapsed() <= 2_000 && h.elapsed() >= 1_900, true, "bounded retry spends at most the 2s window");
  const blocking = `fixed(${BLOCKING_PROXY_CONFIG.proxyRules})`;
  assert.deepEqual(h.setProxyLog().slice(-4), ["site", "default", "net", "app"].map(name => `${name}.setProxy:${blocking}`));
  assert.equal(h.setProxyLog().some(line => line.endsWith(":system") || line.endsWith(":direct")), false, "never falls back to system or direct");
  const state = h.runtime.state();
  assert.equal(state.applied, null, "the blocking config is never recorded as applied");
  assert.equal(state.blocked, true);
  assert.equal(state.appliedResult, "proxy_apply_failed");
  assert.equal(h.auth.basis.applied, null);
  assert.equal(h.auth.basis.applying, null);
  assert.equal(h.log.includes("auth.restore"), true, "the credential snapshot is restored after a failed apply");
});

test("at runtime a failed apply restores and re-verifies the previous config; a failed restore blocks", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  h.log.length = 0;
  h.broken.add("site");
  let checks = 0;
  const original = h.site.resolveProxy.bind(h.site);
  h.site.resolveProxy = async url => { checks++; const value = await original(url); return h.site.config?.proxyRules?.includes("proxy-a") ? chromiumResolve(h.site.config) : value; };
  assert.deepEqual(await h.runtime.applyNow(P2), { ok: false, result: "proxy_apply_failed" });
  assert.equal(checks > 1, true);
  assert.deepEqual(h.setProxyLog().slice(-4), ["site", "default", "net", "app"].map(name => `${name}.setProxy:fixed(http://proxy-a.example:7890)`));
  let state = h.runtime.state();
  assert.equal(state.applied === P1 && !state.blocked && state.appliedResult === "proxy_apply_failed", true);
  assert.equal(h.auth.basis.applied === P1 && h.auth.basis.applying === null, true);

  h.site.resolveProxy = original;
  assert.deepEqual(await h.runtime.applyNow(P2), { ok: false, result: "proxy_apply_failed" });
  state = h.runtime.state();
  assert.equal(state.blocked, true, "previous config no longer verifies either: block");
  assert.equal(state.applied === P1, true, "applied stays the last good config, never the blocking one");
  assert.equal(h.runtime.webrtcPolicy(), "disable_non_proxied_udp");
});

for (const [label, stored] of [
  ["following flag is corrupt", inputs({ following: invalid, override: ok(P1) })],
  ["not following and override is corrupt", inputs({ following: ok(false), override: invalid })],
  ["following and A is corrupt", inputs({ following: ok(true), accepted: invalid, override: ok(P1) })],
  ["following, A absent and override not ok", inputs({ following: ok(true), override: invalid })],
  ["following, A absent and override absent", inputs({ following: ok(true), shared: ok(shared(P2)) })]
] as const) {
  test(`stored data: ${label} blocks at startup instead of falling back to system`, async () => {
    const h = harness({ inputs: stored });
    await h.runtime.recomputeFromStore();
    const state = h.runtime.state();
    assert.equal(state.blocked, true);
    assert.equal(state.stored, "invalid");
    assert.equal(state.appliedResult, "proxy_apply_failed");
    assert.equal(state.applied, null);
    assert.equal(state.pendingConfirm, null);
    assert.equal(h.setProxyLog().every(line => line.endsWith(`fixed(${BLOCKING_PROXY_CONFIG.proxyRules})`)), true);
    assert.equal(h.setProxyLog().length, 4);
    assert.deepEqual(h.accepted, []);
  });
}

test("following with a corrupt S falls back to the accepted value and reports stored=invalid", async () => {
  const h = harness({ inputs: inputs({ following: ok(true), shared: invalid, accepted: ok(P1) }) });
  await h.runtime.recomputeFromStore();
  const state = h.runtime.state();
  assert.equal(state.blocked, false);
  assert.equal(state.applied === P1, true);
  assert.equal(state.stored, "invalid");
  assert.equal(state.following, true);
});

test("an empty profile (no deviceId, nothing stored) applies the system default", async () => {
  const h = harness();
  await h.runtime.recomputeFromStore();
  const state = h.runtime.state();
  assert.deepEqual([state.blocked, state.stored, state.appliedResult, state.following], [false, "ok", "ok", false]);
  assert.equal(state.applied === SYSTEM, true);
  assert.equal(state.formValue === SYSTEM, true);
});

test("following: a new synced address waits for confirmation; bypass-only changes are adopted and accepted after verify", async () => {
  const moved = harness({ inputs: inputs({ following: ok(true), accepted: ok(P1), shared: ok(shared(P2, 700)) }) });
  await moved.runtime.recomputeFromStore();
  let state = moved.runtime.state();
  assert.equal(state.applied === P1, true, "traffic stays on the confirmed proxy");
  assert.deepEqual(state.pendingConfirm, { scheme: "http", host: "proxy-b.example", port: 7890, version: { updatedAt: 700, deviceId: "device-b" } });
  assert.equal(state.formValue === P1, true, "the form never shows the unconfirmed address");
  assert.deepEqual(moved.accepted, [], "A already equals the base: no meta write");

  const bypass = { ...P1, bypass: ["*.corp.example"] };
  const adopted = harness({ inputs: inputs({ following: ok(true), accepted: ok(P1), shared: ok(shared(bypass)) }) });
  await adopted.runtime.recomputeFromStore();
  state = adopted.runtime.state();
  assert.equal(state.applied === bypass && state.pendingConfirm === null, true);
  assert.deepEqual(adopted.accepted, [bypass]);

  const failing = harness({ inputs: inputs({ following: ok(true), accepted: ok(P1), shared: ok(shared(bypass)) }) });
  failing.broken.add("site");
  await failing.runtime.recomputeFromStore();
  assert.deepEqual(failing.accepted, [], "A is only written after verification passes");
});

test("request() while the gate is busy only marks dirty; idle flushes once with the newest inputs", async () => {
  const h = harness({ inputs: inputs({ override: ok(P1) }) });
  const gate = new OperationGate();
  await h.runtime.recomputeFromStore();
  h.runtime.bindBusySource(gate);
  h.log.length = 0;
  const release = deferred();
  const busy = gate.run(() => release.promise);
  h.runtime.request();
  h.setInputs(inputs({ override: ok(DIRECT) }));
  h.runtime.request();
  h.setInputs(inputs({ override: ok(P2) }));
  h.runtime.request();
  await settle();
  assert.equal(h.runtime.state().pending, true);
  assert.deepEqual(h.setProxyLog(), [], "nothing is applied while a shell mutation holds the gate");
  release.resolve(); await busy; await settle();
  assert.deepEqual(h.setProxyLog().map(line => line.split(":")[0]), ["site.setProxy", "default.setProxy", "net.setProxy", "app.setProxy"]);
  assert.equal(h.setProxyLog().every(line => line.includes("proxy-b.example")), true, "only the newest inputs are applied");
  assert.equal(h.runtime.state().applied === P2, true);
  assert.equal(h.runtime.state().pending, false);
});

test("the background recompute holds the gate, so a broadcast arriving meanwhile gets operation_busy", async () => {
  const h = harness({ inputs: inputs({ override: ok(P1) }) });
  const gate = new OperationGate();
  h.runtime.bindBusySource(gate);
  const hold = deferred();
  h.holds.set("site", hold.promise);
  h.runtime.request();
  await settle();
  assert.equal(gate.busy, true);
  await assert.rejects(gate.run(async () => "broadcast"), /operation_busy/);
  h.holds.delete("site"); hold.resolve(); await settle();
  assert.equal(gate.busy, false);
  assert.equal(h.runtime.state().applied === P1, true);
});

test("a refresh during a gated proxy write does not roll the applied config back", async () => {
  const h = harness({ inputs: inputs({ following: ok(true), accepted: ok(P1), shared: ok(shared(P2, 700)) }) });
  const gate = new OperationGate();
  await h.runtime.recomputeFromStore();
  h.runtime.bindBusySource(gate);
  // 模拟 proxy-accept：gate 内持写锁，应用 S、写 A；期间一次同步拉取触发 refresh。
  await gate.run(() => h.runtime.withWriteLock(async () => {
    h.runtime.request();
    const result = await h.runtime.applyNow(P2);
    assert.deepEqual(result, { ok: true });
    h.setInputs(inputs({ following: ok(true), accepted: ok(P2), shared: ok(shared(P2, 700)) }));
  }));
  await settle();
  const state = h.runtime.state();
  assert.equal(state.applied === P2, true, "the deferred recompute reads the newest store, not a stale snapshot");
  assert.equal(state.pendingConfirm, null);
  assert.equal(state.pending, false);
});

test("while a local reset runs, request() keeps the dirty flag and the next refresh flushes it", async () => {
  const h = harness({ inputs: inputs({ override: ok(P1) }) });
  const gate = new OperationGate();
  let resetting = true;
  h.runtime.bindBusySource(gate, () => resetting);
  h.runtime.request();
  await settle();
  assert.deepEqual(h.setProxyLog(), []);
  assert.equal(h.runtime.state().pending, true);
  resetting = false;
  h.setInputs(inputs());
  h.runtime.request();
  await settle();
  assert.equal(h.runtime.state().applied === SYSTEM, true);
  assert.equal(h.runtime.state().pending, false);
});

test("wipeSecrets waits for an in-flight write pipeline, then clears in order", async () => {
  const h = harness();
  const encrypt = deferred();
  const write = h.runtime.withWriteLock(async () => { h.log.push("write.start"); await encrypt.promise; h.log.push("write.renamed"); });
  const wipe = h.runtime.wipeSecrets();
  await settle();
  assert.equal(h.cleared(), 0, "reset waits for the write lock");
  assert.equal(h.runtime.wipeEpoch(), 0);
  encrypt.resolve(); await write; await wipe;
  assert.equal(h.runtime.wipeEpoch(), 1);
  assert.deepEqual(h.log, ["write.start", "write.renamed", "auth.beginWipe", "secrets.clear", "auth.resetBreaker",
    "site.clearAuthCache", "default.clearAuthCache", "net.clearAuthCache", "auth.endWipe"]);
});

test("a failing wipe step fails the whole wipe, ends the wiping state and releases the lock", async () => {
  const h = harness({ secretsClear: async () => { throw new Error("unlink_failed"); } });
  await assert.rejects(h.runtime.wipeSecrets(), /unlink_failed/);
  assert.deepEqual(h.log, ["auth.beginWipe", "auth.endWipe"]);
  assert.equal(await h.runtime.withWriteLock(async () => "free"), "free");
});

test("a reset during a failing apply abandons it without restoring the credential snapshot", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  h.log.length = 0;
  const hold = deferred();
  h.holds.set("site", hold.promise);
  const apply = h.runtime.applyNow(P2, "typed-secret");
  await settle();
  const genBefore = h.auth.gen();
  await h.runtime.wipeSecrets();
  h.holds.delete("site"); hold.resolve();
  assert.deepEqual(await apply, { ok: false, result: "proxy_busy" });
  assert.equal(h.log.includes("auth.restore"), false, "the wiped cache is not refilled from the pre-reset snapshot");
  assert.equal(h.cleared(), 1);
  assert.equal(h.auth.gen() >= genBefore, true, "generation never goes backwards");
  assert.equal(h.runtime.state().applied === P1, true);
});

test("a reset during a failing apply leaves no cached, stored or synced proxy secret behind (real auth, secret file and store)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-proxy-runtime-"));
  const path = join(directory, "proxy-secret.bin");
  const crypto: TokenCrypto = {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async value => Buffer.from(`cipher:${value}`),
    decrypt: async value => value.toString().slice(7)
  };
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "device-a");
  try {
    const secrets = new SecretFileStore(path, crypto);
    const auth = new ProxyAuth({ store: secrets });
    const store = new ProxyPreferenceStore(database, { now: () => 1_000 });
    // ProxyAuth 的 gen 是私有字段；只读、不改，用来核对「永不回退」。
    const gen = () => (auth as unknown as { gen: number }).gen;
    const h = harness({ real: { auth, store, secrets } });
    assert.deepEqual(await h.runtime.applyNow(P1, "old-secret"), { ok: true });
    assert.equal(await auth.persistCredential(P1, "old-secret", auth.wipeEpoch()), "saved");
    assert.equal(auth.secretState(), "saved");
    assert.equal((await stat(path)).isFile(), true);

    const hold = deferred();
    h.holds.set("site", hold.promise);
    const apply = h.runtime.applyNow(P2, "typed-secret");
    await settle();
    assert.equal(h.setProxyLog().at(-1), "site.setProxy:fixed(http://proxy-b.example:7890)", "the apply is stuck in setProxy");
    const genBefore = gen();
    const epochBefore = h.runtime.wipeEpoch();
    await h.runtime.wipeSecrets();
    assert.equal(h.runtime.wipeEpoch(), epochBefore + 1);
    assert.equal(h.runtime.wipeEpoch(), auth.wipeEpoch(), "runtime reads the epoch from auth, it keeps no counter of its own");
    h.holds.delete("site"); hold.resolve();
    assert.deepEqual(await apply, { ok: false, result: "proxy_busy" });

    assert.equal(auth.secretState(), "unknown", "cache is empty: neither the typed nor the pre-reset password is restored");
    await assert.rejects(stat(path), { code: "ENOENT" });
    assert.deepEqual(await secrets.read(), { kind: "none" });
    // regression guard: runtime must not write meta/outbox
    for (const key of [PROXY_OVERRIDE_KEY, PROXY_FOLLOWING_KEY, PROXY_ACCEPTED_KEY]) {
      assert.equal(database.meta.has(key), false, `meta must not carry ${key}`);
    }
    assert.equal(database.state.has(PROXY_STATE_KEY), false);
    assert.equal(database.outbox.count(), 0, "nothing proxy-related is queued for sync");
    assert.equal(gen() > genBefore, true, "generation never goes backwards");
    assert.equal(h.runtime.state().applied === P1, true);
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

// T7 下游交接：钥匙环锁定时，设置卡的惰性读盘停在 decryptStringAsync 上；本机重置在写锁内 await 的 secrets.clear()
// 排在这次 read 后面，只能靠 SecretFileStore 的钥匙环时限放行。没有这个时限，重置会卡死、写锁永远不释放。
test("a reset while a secret read hangs on the keyring finishes, deletes the file and frees the write lock (real auth and secret file)", { timeout: 2000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-proxy-runtime-"));
  const path = join(directory, "proxy-secret.bin");
  const decrypting = deferred();
  const late = deferred();
  const crypto: TokenCrypto = {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async value => Buffer.from(`cipher:${value}`),
    decrypt: async value => {
      decrypting.resolve();
      await late.promise; // 钥匙环锁定：decryptStringAsync 不返回
      return value.toString().slice(7);
    }
  };
  try {
    await new SecretFileStore(path, crypto).write("stored-before-reset");
    const secrets = new SecretFileStore(path, crypto, { keyringTimeoutMs: 20 });
    const auth = new ProxyAuth({ store: secrets }); // readTimeoutMs 保持缺省 5s：放行写锁的只能是 SecretFileStore 的时限
    const h = harness({ real: { auth, store: { read: () => inputs(), setAccepted: () => true }, secrets } });

    const refreshing = auth.refreshSecretState(); // 设置卡打开时 proxy-state {secret:true} 触发的惰性读盘
    await decrypting.promise;
    assert.equal(auth.secretState(), "unknown", "the read is stuck in decrypt");

    const started = Date.now();
    await h.runtime.wipeSecrets();
    assert.equal(Date.now() - started < 1_000, true, "the queued clear runs once the 20ms keyring limit drops the stuck read");
    await assert.rejects(stat(path), { code: "ENOENT" });
    assert.deepEqual(h.log.filter(line => line.endsWith(".clearAuthCache")),
      ["site.clearAuthCache", "default.clearAuthCache", "net.clearAuthCache"], "every wipe step after clear still ran");
    assert.equal(await h.runtime.withWriteLock(async () => "free"), "free", "the write lock is released");
    await refreshing;
    assert.equal(auth.secretState(), "unknown", "the timed-out read cannot refill the wiped cache");

    late.resolve(); // 钥匙环迟到地返回了明文
    await settle();
    await assert.rejects(stat(path), { code: "ENOENT" }, "the late decrypt has no side effect");
    assert.equal(auth.secretState(), "unknown");
  } finally {
    late.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebRTC policy follows the applied mode and is pushed to every live site view", async () => {
  const h = harness();
  await h.runtime.applyNow(P1);
  assert.equal(h.runtime.webrtcPolicy(), "disable_non_proxied_udp");
  await h.runtime.applyNow(SYSTEM);
  assert.equal(h.runtime.webrtcPolicy(), "default");
  assert.deepEqual(h.contents[0].policies, ["disable_non_proxied_udp", "default"]);
  assert.deepEqual(h.contents[1].policies, [], "destroyed views are skipped");
});

test("state changes are pushed: apply completion, pending, and secret-state changes from auth", async () => {
  const h = harness();
  const gate = new OperationGate();
  h.runtime.bindBusySource(gate);
  let pushes = 0;
  const stop = h.runtime.onChange(() => { pushes++; });
  await h.runtime.applyNow(P1);
  assert.equal(pushes > 0, true);
  const before = pushes;
  const release = deferred();
  const busy = gate.run(() => release.promise);
  h.runtime.request();
  assert.equal(pushes > before, true, "becoming pending is published");
  release.resolve(); await busy; await settle();
  const afterFlush = pushes;
  for (const listener of h.authListeners) listener();
  assert.equal(pushes, afterFlush + 1);
  stop();
  for (const listener of h.authListeners) listener();
  assert.equal(pushes, afterFlush + 1);
});

// 加密可用性不归 runtime（preflight R4）：只来自 auth.securePersistence()（T8 契约，T14 使用）。
test("the Linux proxy source and the secret state are reported", async () => {
  const runtime = new ProxyRuntime({
    sessions: () => [], verifySessions: () => [], app: { setProxy: async () => undefined },
    auth: { setBasis() {}, beginApply: () => null, restore() {}, resetBreaker() {}, wipeEpoch: () => 0, beginWipe() {}, endWipe() {}, secretState: () => "unknown", onChange: () => () => undefined },
    store: { read: () => inputs(), setAccepted: () => true }, secrets: { clear: async () => undefined }, webContents: () => [],
    environment: { linuxDesktopProxy: "env" }
  });
  assert.equal(runtime.state().linuxDesktopProxy, "env");
  assert.equal(runtime.state().secret, "unknown");
});

test("linuxDesktopProxySource: only desktops Chromium reads settings from count as desktop", () => {
  assert.equal(linuxDesktopProxySource("win32", { XDG_CURRENT_DESKTOP: "GNOME" }), null);
  assert.equal(linuxDesktopProxySource("darwin", {}), null);
  assert.equal(linuxDesktopProxySource("linux", { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }), "desktop");
  assert.equal(linuxDesktopProxySource("linux", { XDG_CURRENT_DESKTOP: "KDE" }), "desktop");
  assert.equal(linuxDesktopProxySource("linux", { XDG_CURRENT_DESKTOP: "X-Cinnamon" }), "desktop");
  assert.equal(linuxDesktopProxySource("linux", { XDG_CURRENT_DESKTOP: "XFCE" }), "env");
  assert.equal(linuxDesktopProxySource("linux", {}), "env", "WSL / bare X: environment variables");
});
