import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AuthInfo } from "electron";

import {
  decodeProxySecret, encodeProxySecret, normalizeProxyHost, ProxyAuth, PROXY_SECRET_RETRY_MS, type ProxyAuthStore
} from "../src/main/proxy-auth";
import {
  SecretFileStore, type SecretReadResult, type SecretWriteGuard, type SecretWriteResult
} from "../src/main/secret-file-store";
import { checkProxyInput, proxyIdentity, type ProxyPreference } from "../src/shared/proxy-preference";

function proxy(fields: Record<string, unknown> = {}): ProxyPreference {
  const result = checkProxyInput({
    version: 1, mode: "custom", scheme: "http", host: "proxy.example", port: 8080, bypass: [], username: "alice", ...fields
  });
  if (!result.ok) throw new Error(`fixture_${result.field}`);
  return result.value;
}

function payload(value: ProxyPreference, password: string): SecretReadResult {
  const identity = proxyIdentity(value);
  if (!identity) throw new Error("fixture_identity");
  return { kind: "ok", value: encodeProxySecret(identity, password) };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise(done => setImmediate(done));

class FakeStore implements ProxyAuthStore {
  reads = 0;
  clears = 0;
  writes: string[] = [];
  secure = true;
  readResult: SecretReadResult = { kind: "none" };
  readGate: Promise<void> | null = null;
  writeGate: Promise<void> | null = null;
  clearError: Error | null = null;
  writeError: Error | null = null;

  async read(): Promise<SecretReadResult> {
    this.reads += 1;
    if (this.readGate) await this.readGate;
    return this.readResult;
  }

  async write(value: string, guard?: SecretWriteGuard): Promise<SecretWriteResult> {
    this.writes.push(value);
    if (this.writeGate) await this.writeGate;
    if (this.writeError) throw this.writeError;
    if (!this.secure) return "memory";
    return guard && guard.epoch() !== guard.expected ? "aborted" : "saved";
  }

  async clear(): Promise<void> {
    this.clears += 1;
    if (this.clearError) throw this.clearError;
  }

  async securePersistence(): Promise<boolean> { return this.secure; }
}

function info(host: string, port: number, isProxy = true): AuthInfo {
  return { isProxy, scheme: "basic", host, port, realm: "polyask-test" };
}

interface Outcome { prevented: boolean; args: (string | undefined)[] | null }

function appLogin(auth: ProxyAuth, authInfo: AuthInfo, firstAuthAttempt = true): Outcome {
  const outcome: Outcome = { prevented: false, args: null };
  auth.handleAppLogin({ preventDefault: () => { outcome.prevented = true; } }, null, { firstAuthAttempt }, authInfo,
    (...args) => { outcome.args = args; });
  return outcome;
}

function requestLogin(auth: ProxyAuth, request: object, authInfo: AuthInfo): Outcome {
  const outcome: Outcome = { prevented: false, args: null };
  auth.handleRequestLogin(request, authInfo, (...args) => { outcome.args = args; });
  return outcome;
}

const P1 = proxy();

test("non-proxy challenges and unmatched proxies are never intercepted", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });

  const site401 = appLogin(auth, info("proxy.example", 8080, false));
  assert.equal(site401.prevented, false);
  assert.equal(site401.args, null);
  assert.deepEqual(requestLogin(auth, {}, info("proxy.example", 8080, false)).args, []);
  for (const other of [info("other.example", 8080), info("proxy.example", 8081)]) {
    const outcome = appLogin(auth, other);
    assert.equal(outcome.prevented, false);
    assert.equal(outcome.args, null);
  }
  assert.deepEqual(requestLogin(auth, {}, info("other.example", 8080)).args, []);

  auth.setBasis({ applied: proxy({ mode: "system" }), applying: null });
  assert.equal(appLogin(auth, info("proxy.example", 8080)).prevented, false);
  await tick();
  assert.equal(store.reads, 0, "未命中的认证不得触发读盘");
});

test("IPv6 and IDN proxy hosts match their canonical identity", async () => {
  const cases: Array<[ProxyPreference, string]> = [
    [proxy({ host: "::1", port: 3128 }), "[::1]"],
    [proxy({ host: "[2001:DB8::1]", port: 3128 }), "2001:db8:0:0:0:0:0:1"],
    [proxy({ host: "Bücher.Example", port: 3128 }), "BÜCHER.example"]
  ];
  for (const [value, challengeHost] of cases) {
    const store = new FakeStore();
    store.readResult = payload(value, "s3cret");
    const auth = new ProxyAuth({ store });
    auth.setBasis({ applied: value, applying: null });
    const outcome = appLogin(auth, info(challengeHost, 3128));
    assert.equal(outcome.prevented, true, challengeHost);
    await tick();
    assert.deepEqual(outcome.args, ["alice", "s3cret"], challengeHost);
  }
  assert.equal(normalizeProxyHost("[::1]"), "::1");
  assert.equal(normalizeProxyHost("bücher.example"), "xn--bcher-kva.example");
  assert.equal(normalizeProxyHost("user@host"), null);
});

test("the applied config is the basis while a newer preference waits for idle", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  const pendingPreference = proxy({ host: "next.example" });

  const old = appLogin(auth, info("proxy.example", 8080));
  await tick();
  assert.deepEqual(old.args, ["alice", "s3cret"]);
  const next = appLogin(auth, info(pendingPreference.host, 8080));
  assert.equal(next.prevented, false, "尚未应用的偏好值不是匹配基准");
});

test("preventDefault is synchronous and a 407 that arrives while loading gets the password", async () => {
  const store = new FakeStore();
  const gate = deferred();
  store.readGate = gate.promise;
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });

  const first = appLogin(auth, info("proxy.example", 8080));
  assert.equal(first.prevented, true, "必须在 handler 返回前同步 preventDefault");
  assert.equal(first.args, null);
  const second = appLogin(auth, info("proxy.example", 8080));
  assert.equal(store.reads, 1, "loading 期间不重复读盘");
  assert.equal(auth.secretState(), "unknown");

  gate.resolve();
  await auth.refreshSecretState();
  assert.deepEqual(first.args, ["alice", "s3cret"]);
  assert.deepEqual(second.args, ["alice", "s3cret"]);
  assert.equal(auth.secretState(), "saved");
});

test("a wipe during the disk read discards the result and cancels challenges without reading", async () => {
  const store = new FakeStore();
  const gate = deferred();
  store.readGate = gate.promise;
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });

  const waiting = appLogin(auth, info("proxy.example", 8080));
  const epoch = auth.wipeEpoch();
  auth.beginWipe();
  assert.equal(auth.wipeEpoch(), epoch + 1);
  assert.deepEqual(waiting.args, [], "重置开始时等待中的 407 立即取消");
  const during = appLogin(auth, info("proxy.example", 8080));
  assert.equal(during.prevented, true);
  assert.deepEqual(during.args, []);
  gate.resolve();
  await tick();
  await tick();
  assert.equal(store.reads, 1, "wiping 期间不读盘");
  assert.equal(auth.secretState(), "unknown", "旧密码不得在重置后写回缓存");

  await auth.clearStored();
  auth.endWipe();
  store.readGate = null;
  store.readResult = { kind: "none" };
  const after = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.deepEqual(after.args, []);
  assert.equal(auth.secretState(), "none");
});

test("first-attempt bursts never trip; two retries within 60s do; credential or identity change resets", async () => {
  let now = 1_000_000;
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store, now: () => now });
  auth.setBasis({ applied: P1, applying: null });
  let changes = 0;
  auth.onChange(() => { changes += 1; });

  const burst = Array.from({ length: 9 }, () => appLogin(auth, info("proxy.example", 8080), true));
  await auth.refreshSecretState();
  for (const outcome of burst) assert.deepEqual(outcome.args, ["alice", "s3cret"]);
  assert.equal(auth.authFailed(), false, "九站并发首载不得熔断");

  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["alice", "s3cret"]);
  now += 59_000;
  const before = changes;
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, []);
  assert.equal(auth.authFailed(), true);
  assert.equal(changes > before, true, "熔断要通知 runtime 发布 proxy_auth_failed");
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), true).args, [], "熔断后对该身份一律取消");

  auth.beginApply(P1, "new-pass", false);
  auth.setBasis({ applied: P1, applying: null });
  assert.equal(auth.authFailed(), false, "换密码清零熔断");
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["alice", "new-pass"]);

  const bob = proxy({ username: "bob" });
  appLogin(auth, info("proxy.example", 8080), false);
  assert.equal(auth.authFailed(), true);
  auth.beginApply(bob, "bob-pass", true);
  auth.setBasis({ applied: bob, applying: null });
  assert.equal(auth.authFailed(), false, "身份变化清零熔断");
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["bob", "bob-pass"]);
});

test("failures older than the 60s window decay instead of tripping", async () => {
  let now = 0;
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store, now: () => now });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();

  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["alice", "s3cret"]);
  now += 61_000;
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["alice", "s3cret"]);
  assert.equal(auth.authFailed(), false);
});

test("request-level login counts the same request entering twice", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();

  const request = {};
  assert.deepEqual(requestLogin(auth, request, info("proxy.example", 8080)).args, ["alice", "s3cret"]);
  assert.deepEqual(requestLogin(auth, request, info("proxy.example", 8080)).args, ["alice", "s3cret"]);
  assert.equal(auth.authFailed(), false);
  assert.deepEqual(requestLogin(auth, request, info("proxy.example", 8080)).args, []);
  assert.equal(auth.authFailed(), true);
  assert.deepEqual(requestLogin(auth, {}, info("proxy.example", 8080)).args, []);
});

test("changing host and password together hands the new password to the first 407 from the new proxy", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();
  const P2 = proxy({ host: "next.example", port: 3128 });

  const epoch = auth.wipeEpoch();
  auth.beginApply(P2, "fresh", true);
  const outcome = appLogin(auth, info("next.example", 3128));
  assert.equal(outcome.prevented, true, "applying 也是匹配基准");
  assert.deepEqual(outcome.args, ["alice", "fresh"], "凭据在第 1 步装入，无需读盘");
  assert.equal(store.reads, 1);

  auth.setBasis({ applied: P2, applying: null });
  assert.equal(auth.secretState(), "memory");
  assert.equal(await auth.persistCredential(P2, "fresh", epoch), "saved");
  assert.equal(auth.secretState(), "saved");
  const written = decodeProxySecret(store.writes[0]);
  assert.deepEqual(written, {
    identity: { scheme: "http", host: "next.example", port: 3128, username: "alice" }, password: "fresh"
  });
});

test("a password with ':', '@' and non-ASCII characters is handed over and persisted unchanged", async () => {
  // p@ss:wörd：用转义写死预组合的 ö（U+00F6）。Chromium 自己按 UTF-8 做 Basic 编码，这里只能原样交出字符串。
  const password = "p@ss:w\u00f6rd";
  assert.equal(password.length, 9);
  const store = new FakeStore();
  const auth = new ProxyAuth({ store });
  auth.beginApply(P1, password, true);
  auth.setBasis({ applied: P1, applying: null });

  const site = appLogin(auth, info("proxy.example", 8080));
  assert.equal(site.prevented, true);
  assert.deepEqual(site.args, ["alice", password], "app.on('login') 原样交出：不做 URL 编码、不按冒号或 @ 截断");
  assert.deepEqual(requestLogin(auth, {}, info("proxy.example", 8080)).args, ["alice", password], "请求级 login 同样原样");

  assert.equal(await auth.persistCredential(P1, password, auth.wipeEpoch()), "saved");
  assert.equal(decodeProxySecret(store.writes[0])?.password, password, "密码文件明文原样保存");

  const reloaded = new FakeStore();
  reloaded.readResult = { kind: "ok", value: store.writes[0] };
  const reader = new ProxyAuth({ store: reloaded });
  reader.setBasis({ applied: P1, applying: null });
  const fromDisk = appLogin(reader, info("proxy.example", 8080));
  await reader.refreshSecretState();
  assert.deepEqual(fromDisk.args, ["alice", password], "读盘后交出的仍是原串");
  assert.equal(reader.authFailed(), false);
});

test("clearing the password installs a tombstone that survives a failed file delete", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();

  auth.beginApply(P1, null, false);
  auth.setBasis({ applied: P1, applying: null });
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080)).args, []);
  store.clearError = new Error("EBUSY");
  assert.equal(await auth.persistCredential(P1, null, auth.wipeEpoch()), "failed");
  const after = appLogin(auth, info("proxy.example", 8080));
  assert.equal(after.prevented, true);
  assert.deepEqual(after.args, []);
  assert.equal(store.reads, 1, "墓碑命中不读盘，旧密码文件读不回来");
  assert.equal(auth.secretState(), "none");
});

test("a failed apply restores the previous entry unless a wipe happened, and never rolls the generation back", async () => {
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();
  const P2 = proxy({ host: "next.example" });

  auth.restore(auth.beginApply(P2, "fresh", true));
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080)).args, ["alice", "s3cret"]);
  assert.equal(appLogin(auth, info("next.example", 8080)).prevented, false, "恢复后 applying 已清空");

  const snapshot = auth.beginApply(P2, "fresh", true);
  auth.beginWipe();
  auth.endWipe();
  auth.restore(snapshot);
  assert.equal(auth.secretState(), "unknown", "期间发生过本机重置就不恢复");

  const gate = deferred();
  store.readGate = gate.promise;
  const inFlight = appLogin(auth, info("proxy.example", 8080));
  auth.restore(auth.beginApply(P2, undefined, true));
  assert.deepEqual(inFlight.args, [], "代际号变化取消等待中的 407");
  gate.resolve();
  await tick();
  await tick();
  assert.equal(auth.secretState(), "unknown", "恢复不回退代际号，晚到的读取结果被丢弃");
});

test("secret state reports none, unreadable, mismatch and memory, and identity binding withholds mismatched passwords", async () => {
  const states: string[] = [];
  for (const result of [{ kind: "none" }, { kind: "unreadable" }, { kind: "ok", value: "not-json" }] as SecretReadResult[]) {
    const store = new FakeStore();
    store.readResult = result;
    const auth = new ProxyAuth({ store });
    auth.setBasis({ applied: P1, applying: null });
    states.push(auth.secretState());
    await auth.refreshSecretState();
    states.push(auth.secretState());
  }
  assert.deepEqual(states, ["unknown", "none", "unknown", "unreadable", "unknown", "unreadable"]);

  const store = new FakeStore();
  store.readResult = payload(proxy({ username: "bob" }), "bob-pass");
  const auth = new ProxyAuth({ store });
  auth.setBasis({ applied: P1, applying: null });
  let notified = 0;
  auth.onChange(() => { notified += 1; });
  await auth.refreshSecretState();
  assert.equal(auth.secretState(), "mismatch");
  assert.equal(notified > 0, true);
  const outcome = appLogin(auth, info("proxy.example", 8080));
  assert.equal(outcome.prevented, true);
  assert.deepEqual(outcome.args, [], "用户名不同即身份不同，不交出密码");

  const insecure = new FakeStore();
  insecure.secure = false;
  const memoryAuth = new ProxyAuth({ store: insecure });
  memoryAuth.beginApply(P1, "pw", true);
  memoryAuth.setBasis({ applied: P1, applying: null });
  assert.equal(await memoryAuth.persistCredential(P1, "pw", memoryAuth.wipeEpoch()), "memory");
  assert.equal(memoryAuth.secretState(), "memory");
  assert.equal(await memoryAuth.securePersistence(), false);
});

test("a stuck read times out and cancels the waiting challenge", async () => {
  const store = new FakeStore();
  store.readGate = new Promise<void>(() => {});
  const auth = new ProxyAuth({ store, readTimeoutMs: 20 });
  auth.setBasis({ applied: P1, applying: null });
  const outcome = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.deepEqual(outcome.args, []);
  assert.equal(auth.secretState(), "unknown");
});

test("persisting aborts when a wipe lands during the encrypted write", async () => {
  const store = new FakeStore();
  const gate = deferred();
  store.writeGate = gate.promise;
  const auth = new ProxyAuth({ store });
  auth.beginApply(P1, "pw", true);
  auth.setBasis({ applied: P1, applying: null });
  const pending = auth.persistCredential(P1, "pw", auth.wipeEpoch());
  auth.beginWipe();
  gate.resolve();
  assert.equal(await pending, "aborted");
  assert.equal(auth.secretState(), "unknown");
  auth.endWipe();
});

test("the real SecretFileStore round-trips an identity-bound password across instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "polyask-proxy-auth-"));
  const path = join(directory, "proxy-secret.bin");
  const crypto = {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async (value: string) => Buffer.from(`cipher:${value}`),
    decrypt: async (value: Buffer) => value.toString().slice(7)
  };
  try {
    const writer = new ProxyAuth({ store: new SecretFileStore(path, crypto) });
    writer.beginApply(P1, "s3cret", true);
    writer.setBasis({ applied: P1, applying: null });
    assert.equal(await writer.persistCredential(P1, "s3cret", writer.wipeEpoch()), "saved");

    const reader = new ProxyAuth({ store: new SecretFileStore(path, crypto) });
    reader.setBasis({ applied: P1, applying: null });
    const granted = appLogin(reader, info("proxy.example", 8080));
    await reader.refreshSecretState();
    assert.deepEqual(granted.args, ["alice", "s3cret"]);

    const other = new ProxyAuth({ store: new SecretFileStore(path, crypto) });
    const bob = proxy({ username: "bob" });
    other.setBasis({ applied: bob, applying: null });
    const denied = appLogin(other, info("proxy.example", 8080));
    await other.refreshSecretState();
    assert.deepEqual(denied.args, []);
    assert.equal(other.secretState(), "mismatch");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  assert.equal(decodeProxySecret(JSON.stringify({ version: 1, scheme: "ftp", host: "h", port: 1, username: "", password: "x" })), null);
  assert.equal(decodeProxySecret(JSON.stringify({ version: 1, scheme: "http", host: "h", port: 0, username: "", password: "x" })), null);
  assert.equal(decodeProxySecret(JSON.stringify({ version: 1, scheme: "http", host: "h", port: 1, username: "", password: "" })), null);
});

test("a throwing change listener cannot swallow a 407 callback or strand a wipe", async () => {
  let now = 0;
  const store = new FakeStore();
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store, now: () => now });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();
  let later = 0;
  auth.onChange(() => { throw new Error("webContents destroyed"); });
  auth.onChange(() => { later += 1; });

  assert.deepEqual(appLogin(auth, info("proxy.example", 8080), false).args, ["alice", "s3cret"]);
  now += 1_000;
  const tripping = appLogin(auth, info("proxy.example", 8080), false);
  assert.deepEqual(tripping.args, [], "熔断那一次仍按取消语义回调");
  assert.equal(auth.authFailed(), true);
  assert.equal(later > 0, true, "其余监听器照常收到通知");

  assert.doesNotThrow(() => auth.beginWipe());
  assert.equal(auth.secretState(), "unknown");
  auth.endWipe();
  const after = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.deepEqual(after.args, ["alice", "s3cret"], "endWipe 后缓存回到 null，重新读盘");
});

test("a throwing queued callback does not stall the rest of the batch or refreshSecretState", async () => {
  const store = new FakeStore();
  const gate = deferred();
  store.readGate = gate.promise;
  store.readResult = payload(P1, "s3cret");
  const auth = new ProxyAuth({ store, readTimeoutMs: 60_000 });
  auth.setBasis({ applied: P1, applying: null });

  const first = appLogin(auth, info("proxy.example", 8080));
  auth.handleAppLogin({ preventDefault: () => {} }, null, { firstAuthAttempt: true }, info("proxy.example", 8080),
    () => { throw new Error("callback boom"); });
  const third = appLogin(auth, info("proxy.example", 8080));
  gate.resolve();
  await auth.refreshSecretState();
  assert.deepEqual(first.args, ["alice", "s3cret"]);
  assert.deepEqual(third.args, ["alice", "s3cret"]);
  assert.equal(auth.secretState(), "saved");
});

test("a malformed read result settles waiters as unreadable instead of escaping as a rejection", async () => {
  const store = new FakeStore();
  store.readResult = undefined as unknown as SecretReadResult;
  const auth = new ProxyAuth({ store, readTimeoutMs: 60_000 });
  auth.setBasis({ applied: P1, applying: null });
  const outcome = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.deepEqual(outcome.args, []);
  assert.equal(auth.secretState(), "unreadable");
});

test("an unreadable result is retried only after PROXY_SECRET_RETRY_MS", async () => {
  let now = 0;
  const store = new FakeStore();
  store.readResult = { kind: "unreadable" };
  const auth = new ProxyAuth({ store, now: () => now });
  auth.setBasis({ applied: P1, applying: null });
  await auth.refreshSecretState();
  assert.equal(auth.secretState(), "unreadable");
  assert.equal(PROXY_SECRET_RETRY_MS, 30_000);

  store.readResult = payload(P1, "s3cret");
  now += PROXY_SECRET_RETRY_MS - 1;
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080)).args, [], "30s 内照旧取消");
  await auth.refreshSecretState();
  assert.equal(store.reads, 1, "30s 内不重读");
  assert.equal(auth.secretState(), "unreadable");

  now += 1;
  const retried = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.equal(store.reads, 2);
  assert.deepEqual(retried.args, ["alice", "s3cret"]);
  assert.equal(auth.secretState(), "saved");
});

test("an unreadable result that lands after the read timeout is adopted and retried after 30s", async () => {
  let now = 0;
  const store = new FakeStore();
  const gate = deferred();
  store.readGate = gate.promise;
  store.readResult = { kind: "unreadable" };
  const auth = new ProxyAuth({ store, now: () => now, readTimeoutMs: 20 });
  auth.setBasis({ applied: P1, applying: null });

  const waiting = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.deepEqual(waiting.args, [], "超时先取消等待中的 407");
  now = 1_000;
  gate.resolve();
  await tick();
  await tick();
  assert.equal(auth.secretState(), "unreadable", "代际号未变，晚到的结果被采用");

  store.readGate = null;
  store.readResult = payload(P1, "s3cret");
  now = 1_000 + PROXY_SECRET_RETRY_MS - 1;
  assert.deepEqual(appLogin(auth, info("proxy.example", 8080)).args, []);
  assert.equal(store.reads, 1);
  now = 1_000 + PROXY_SECRET_RETRY_MS;
  const retried = appLogin(auth, info("proxy.example", 8080));
  await auth.refreshSecretState();
  assert.equal(store.reads, 2);
  assert.deepEqual(retried.args, ["alice", "s3cret"]);
});

test("credentialFor answers from memory, withholds on tombstone, wipe or another identity, and defers to disk otherwise", async () => {
  const store = new FakeStore();
  const auth = new ProxyAuth({ store });
  const identity = proxyIdentity(P1)!;
  assert.equal(auth.credentialFor(identity), undefined, "还没读过盘：交给调用方读盘");
  auth.beginApply(P1, "mem", true);
  assert.equal(auth.credentialFor(identity), "mem", "内存里身份一致的密码（含只在本次运行有效的）直接交出");
  assert.equal(auth.credentialFor({ ...identity, host: "PROXY.example" }), "mem", "host 按规范化比较");
  assert.equal(auth.credentialFor({ ...identity, username: "bob" }), null, "缓存是别的身份：不交出，也不回落读盘");
  auth.beginApply(P1, null, false);
  assert.equal(auth.credentialFor(identity), null, "墓碑");
  auth.beginWipe();
  assert.equal(auth.credentialFor(identity), null, "重置中");
  auth.endWipe();
  assert.equal(auth.credentialFor(identity), undefined, "重置结束缓存回到空");
  await auth.refreshSecretState();
  assert.equal(auth.secretState(), "none");
  assert.equal(auth.credentialFor(identity), undefined, "读盘结果为 absent 时仍以磁盘为准");
});

test("a new password that is not persisted removes the stale password file; clearing never touches the keyring", async () => {
  const failing = new FakeStore();
  failing.writeError = new Error("secret_write_timeout");
  const failed = new ProxyAuth({ store: failing });
  failed.beginApply(P1, "P2", false);
  assert.equal(await failed.persistCredential(P1, "P2", failed.wipeEpoch()), "failed", "写盘失败的结果不变");
  assert.equal(failing.clears, 1, "钥匙环超时：删掉仍存着旧密码的文件，下次启动读不回被替换的密码");
  assert.equal(failed.credentialFor(proxyIdentity(P1)!), "P2");

  const insecure = new FakeStore();
  insecure.secure = false;
  const memory = new ProxyAuth({ store: insecure });
  memory.beginApply(P1, "P2", false);
  assert.equal(await memory.persistCredential(P1, "P2", memory.wipeEpoch()), "memory");
  assert.equal(insecure.clears, 1, "只留在内存：同样删掉旧文件");

  const stuck = new FakeStore();
  stuck.secure = false;
  stuck.clearError = new Error("EBUSY");
  const leftover = new ProxyAuth({ store: stuck });
  leftover.beginApply(P1, "P2", false);
  assert.equal(await leftover.persistCredential(P1, "P2", leftover.wipeEpoch()), "failed", "旧文件删不掉：如实报告密码未保存");

  const secure = new FakeStore();
  const saved = new ProxyAuth({ store: secure });
  saved.beginApply(P1, "P2", false);
  assert.equal(await saved.persistCredential(P1, "P2", saved.wipeEpoch()), "saved");
  assert.equal(secure.clears, 0, "写盘成功时新文件已整体覆盖旧文件");

  const wiping = new FakeStore();
  wiping.writeError = new Error("secret_write_timeout");
  const gate = deferred();
  wiping.writeGate = gate.promise;
  const reset = new ProxyAuth({ store: wiping });
  reset.beginApply(P1, "P2", false);
  const pending = reset.persistCredential(P1, "P2", reset.wipeEpoch());
  reset.beginWipe();
  gate.resolve();
  assert.equal(await pending, "aborted");
  assert.equal(wiping.clears, 0, "期间发生本机重置：交给重置自己删文件");
  reset.endWipe();
});
