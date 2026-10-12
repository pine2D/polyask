import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { IpcMainInvokeEvent } from "electron";

import { DataAdminService } from "../src/main/data-admin-service";
import { DesktopDatabase } from "../src/main/database";
import { PreferencesRepository } from "../src/main/preferences-repository";
import { PROXY_SECRET_RETRY_MS, ProxyAuth, type ProxyAuthStore } from "../src/main/proxy-auth";
import { PROXY_IPC_CHANNELS, registerProxyIpc, type ProxyIpcListener, type ProxyRuntimePort } from "../src/main/proxy-ipc";
import {
  classifyProxyInputs, PROXY_ACCEPTED_KEY, PROXY_FOLLOWING_KEY, PROXY_OVERRIDE_KEY, PROXY_STATE_KEY, ProxyPreferenceStore
} from "../src/main/proxy-preference-store";
import { resolveProxyTarget, type PendingConfirm } from "../src/main/proxy-target";
import { SecretFileStore, type SecretReadResult, type SecretWriteResult, type TokenCrypto } from "../src/main/secret-file-store";
import type { SiteKey } from "../src/shared/contracts";
import { OperationGate } from "../src/shared/operation-gate";
import { DEFAULT_PROXY_PREFERENCE, type ProxyPreference } from "../src/shared/proxy-preference";
import type { ProxyStateView, ProxyTestResult } from "../src/shared/proxy-state";
import type { SyncStatus } from "../src/shared/sync";

const P1: ProxyPreference = { version: 1, mode: "custom", scheme: "http", host: "proxy-a.example", port: 7890, bypass: [], username: "alice" };
const P2: ProxyPreference = { ...P1, host: "proxy-b.example" };
const P3: ProxyPreference = { ...P1, host: "proxy-c.example" };
const SOCKS: ProxyPreference = { ...P1, scheme: "socks5", username: "" };
const SYSTEM: ProxyPreference = { ...P1, mode: "system" };
const TRUSTED = { trusted: true } as unknown as IpcMainInvokeEvent;
const UNTRUSTED = { trusted: false } as unknown as IpcMainInvokeEvent;
const BUSY = { ok: false, result: "proxy_busy" };
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const status = (): SyncStatus => ({
  state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: true, secureTokenStorage: true
});

type ApplyOutcome = { readonly ok: true } | { readonly ok: false; readonly result: "proxy_apply_failed" };

/** T11 契约语义的最小运行时：只记录 IPC 交来的参数，应用结果可编排。 */
class FakeRuntime {
  applied: ProxyPreference | null = null;
  blocked = false;
  stored: "ok" | "invalid" = "ok";
  following = false;
  formValue: ProxyPreference = DEFAULT_PROXY_PREFERENCE;
  pendingConfirm: PendingConfirm | null = null;
  epoch = 0;
  failNext = false;
  wipes = 0;
  readonly calls: { target: ProxyPreference; credential: string | null | undefined }[] = [];
  /** 每次 bindBusySource 收到的完整实参列表（rest 参数，保留实参个数，好断言第二个参数确实传了）。 */
  readonly bindings: unknown[][] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: ProxyPreferenceStore, private readonly auth: ProxyAuth) {}

  async applyNow(target: ProxyPreference, credential?: string | null): Promise<ApplyOutcome> {
    this.calls.push({ target, credential });
    return this.commit(target);
  }

  withWriteLock<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action);
    this.tail = run.catch(() => undefined);
    return run;
  }

  wipeEpoch(): number { return this.epoch; }

  /** T11 签名 `bindBusySource(gate, isResetting = () => false)`：重置标志只从第二个参数读，漏传就永远是 false。 */
  bindBusySource(...args: unknown[]): void { this.bindings.push(args); }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(): void { for (const listener of [...this.listeners]) listener(); }

  state(): ReturnType<ProxyRuntimePort["state"]> {
    return {
      applied: this.applied, blocked: this.blocked, stored: this.stored, appliedResult: this.blocked ? "proxy_apply_failed" : "ok",
      pending: false, pendingConfirm: this.pendingConfirm, following: this.following, formValue: this.formValue,
      secret: this.auth.secretState(), encryption: false, linuxDesktopProxy: null, leaked: "internal-only"
    } as unknown as ReturnType<ProxyRuntimePort["state"]>;
  }

  async recomputeFromStore(): Promise<void> {
    const inputs = this.store.read();
    const classified = classifyProxyInputs(inputs);
    this.following = inputs.following.kind === "ok" && inputs.following.value;
    if (classified.kind === "blocked") {
      this.blocked = true; this.stored = "invalid"; this.pendingConfirm = null;
      this.emit();
      return;
    }
    const resolved = resolveProxyTarget(classified.input);
    this.stored = classified.sharedInvalid ? "invalid" : "ok";
    this.pendingConfirm = resolved.pendingConfirm;
    this.formValue = resolved.target;
    const result = await this.commit(resolved.target);
    if (result.ok && resolved.nextAccepted) this.store.setAccepted(resolved.nextAccepted);
    this.emit();
  }

  /** spec §4.6：写锁内 beginWipe → 清密码文件 → 清零熔断 → endWipe。 */
  wipeSecrets(): Promise<void> {
    return this.withWriteLock(async () => {
      this.wipes += 1;
      this.epoch += 1;
      this.auth.beginWipe();
      try { await this.auth.clearStored(); this.auth.resetBreaker(); }
      finally { this.auth.endWipe(); }
    });
  }

  private async commit(target: ProxyPreference): Promise<ApplyOutcome> {
    if (this.failNext) { this.failNext = false; return { ok: false, result: "proxy_apply_failed" }; }
    this.applied = target;
    this.blocked = false;
    return { ok: true };
  }
}

class CountingGate extends OperationGate {
  runs = 0;
  override run<T>(action: () => Promise<T>): Promise<T> {
    this.runs += 1;
    return super.run(action);
  }
}

function secretStub(failWrite: boolean, readResult: SecretReadResult = { kind: "none" }) {
  const writes: string[] = [];
  let reads = 0, clears = 0;
  const store: ProxyAuthStore = {
    read: async (): Promise<SecretReadResult> => { reads += 1; return readResult; },
    write: async (value: string): Promise<SecretWriteResult> => {
      if (failWrite) throw new Error("disk_full");
      writes.push(value);
      return "saved";
    },
    clear: async () => { clears += 1; },
    securePersistence: async () => true
  };
  return { store, writes, counts: () => ({ reads, clears }) };
}

function harness(options: {
  failWrite?: boolean; secrets?: ProxyAuthStore; withoutExtras?: boolean; readResult?: SecretReadResult; authNow?: () => number;
} = {}) {
  const database = DesktopDatabase.open(":memory:");
  database.meta.put("deviceId", "device-a");
  let clock = 1_000;
  const store = new ProxyPreferenceStore(database, { now: () => (clock += 10) });
  const stub = secretStub(options.failWrite === true, options.readResult);
  const auth = new ProxyAuth({ store: options.secrets ?? stub.store, ...(options.authNow ? { now: options.authNow } : {}) });
  const runtime = new FakeRuntime(store, auth);
  const gate = new CountingGate();
  const admin = { isResetting: false };
  const handlers = new Map<string, ProxyIpcListener>();
  const sent: { channel: string; payload: unknown }[] = [];
  const probeCalls: unknown[][] = [];
  const reloads = { count: 0 };
  const extras = options.withoutExtras ? {} : {
    probe: { test: async (input: unknown, password?: string): Promise<ProxyTestResult> => {
      probeCalls.push([input, password]);
      return { ok: true, ms: 12, route: "proxy" };
    } },
    reloadSites: async () => { reloads.count += 1; return { skipped: ["kimi"] as SiteKey[] }; }
  };
  const dispose = registerProxyIpc({
    ...extras,
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener); }, removeHandler: channel => { handlers.delete(channel); } },
    trusted: event => (event as unknown as { trusted?: boolean }).trusted === true,
    gate, dataAdmin: admin, runtime: runtime as unknown as ProxyRuntimePort, auth, store,
    send: (channel, payload) => { sent.push({ channel, payload }); }
  });
  const invoke = (channel: string, value?: unknown): Promise<unknown> => Promise.resolve().then(() => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing handler ${channel}`);
    return handler(TRUSTED, value);
  });
  return { database, store, auth, runtime, gate, admin, handlers, sent, probeCalls, reloads, stub, dispose, invoke };
}

type Harness = ReturnType<typeof harness>;

const sharedValue = (h: Harness) => (h.database.state.get(PROXY_STATE_KEY) as { value?: unknown } | null)?.value ?? null;

/** 本机 P2 并打开跟随（无 S → 上传 P2）；随后另一台设备把 S 改成 P1，地址变了 → 待确认。 */
async function followingWithPending(h: Harness): Promise<PendingConfirm> {
  await h.runtime.recomputeFromStore();
  assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2 }), { ok: true });
  assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: true }), { ok: true });
  h.database.state.put(PROXY_STATE_KEY, { value: P1, updatedAt: 9_000, deviceId: "device-b" }, 9_000, false);
  await h.runtime.recomputeFromStore();
  const pending = h.runtime.pendingConfirm;
  assert.ok(pending, "同步带来的新地址必须先待确认");
  assert.equal(pending.host, "proxy-a.example");
  assert.deepEqual(h.runtime.applied, P2, "确认前流量仍走本机已确认的地址");
  return pending;
}

test("every proxy channel rejects untrusted senders and dispose removes handlers and pushes", async () => {
  const h = harness();
  try {
    assert.deepEqual([...h.handlers.keys()].sort(), [...PROXY_IPC_CHANNELS].sort());
    for (const [channel, handler] of h.handlers) {
      await assert.rejects(Promise.resolve().then(() => handler(UNTRUSTED, { value: P1 })), /untrusted_sender/, channel);
    }
    assert.equal(h.runtime.calls.length + h.probeCalls.length + h.reloads.count + h.gate.runs, 0);
    assert.equal(h.database.meta.get(PROXY_OVERRIDE_KEY), null);
    h.dispose();
    assert.equal(h.handlers.size, 0);
    h.runtime.emit();
    await settle();
    assert.equal(h.sent.length, 0, "dispose 之后不再推送");
  } finally { h.database.close(); }
});

test("test and reload channels are registered only when their services are provided", () => {
  const h = harness({ withoutExtras: true });
  try {
    assert.deepEqual([...h.handlers.keys()].sort(),
      ["polyask:proxy-accept", "polyask:proxy-follow", "polyask:proxy-set", "polyask:proxy-state"]);
  } finally { h.dispose(); h.database.close(); }
});

test("the runtime is bound to the shell gate and, as a separate second argument, to the local-reset flag", async () => {
  const h = harness();
  try {
    assert.equal(h.runtime.bindings.length, 1);
    const args = h.runtime.bindings[0];
    assert.equal(args.length, 2, "T11 只从第二个参数读重置标志：只传一个参数等于重置期间照样后台重算");
    const [gate, isResetting] = args as [unknown, unknown];
    assert.equal(gate, h.gate, "直接传 shell 的 OperationGate：busy / onIdle / run 都来自它，后台重算经 gate.run 执行");
    assert.equal(typeof isResetting, "function");
    const resetting = isResetting as () => boolean;
    assert.equal(resetting(), false);
    h.admin.isResetting = true;
    assert.equal(resetting(), true, "每次调用都读 DataAdminService 的 getter，不是注册时的快照");
    h.admin.isResetting = false;
    assert.equal(resetting(), false);
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-state never reads the password file unless the settings card asks for it", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    // 外壳顶层提示（useProxyPendingNotice）与诊断报告每次启动都会调 proxy-state：不得触发解密（spec §3.3 启动时不读密码）。
    for (const input of [undefined, null, {}, { secret: false }, { secret: "true" }, { secret: 1 }, { secret: true, extra: 1 }, "secret"]) {
      const view = await h.invoke("polyask:proxy-state", input) as ProxyStateView;
      assert.equal(view.secret, "unknown", JSON.stringify(input));
    }
    await settle();
    await settle();
    assert.equal(h.stub.counts().reads, 0, "不带 { secret: true } 时 reads 必须为 0");
    assert.equal(h.auth.secretState(), "unknown");
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-state returns a whitelisted view and, when asked by the settings card, reads the secret lazily, pushing the result", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    const view = await h.invoke("polyask:proxy-state", { secret: true }) as ProxyStateView;
    assert.deepEqual(Object.keys(view).sort(), ["applied", "appliedResult", "authFailed", "blocked", "encryption", "following",
      "formValue", "linuxDesktopProxy", "pending", "pendingConfirm", "secret", "stored"], "逐字段白名单：runtime 内部字段不得到达渲染层");
    assert.deepEqual(view.applied, DEFAULT_PROXY_PREFERENCE);
    assert.equal(view.secret, "unknown", "打开设置卡不做同步解密，先报 unknown");
    assert.equal(view.encryption, true);
    assert.equal(view.authFailed, false);
    await settle();
    await settle();
    assert.equal(h.stub.counts().reads, 1, "设置卡显式请求且 unknown 时，后台读一次密码文件");
    assert.equal(h.auth.secretState(), "none");
    const pushes = h.sent.filter(entry => entry.channel === "polyask:proxy-state-changed");
    assert.equal(pushes.some(entry => (entry.payload as ProxyStateView).secret === "none"), true, "读完经 proxy-state-changed 推送准确状态");
  } finally { h.dispose(); h.database.close(); }
});

// T8 C1：unreadable 满 PROXY_SECRET_RETRY_MS 后可重读（间隔由 proxy-auth 把关）；用户解锁钥匙环后重开设置卡必须能再读一次。
test("proxy-state with the secret flag retries an unreadable password file once the retry interval has passed", async () => {
  let clock = 50_000;
  const h = harness({ readResult: { kind: "unreadable" }, authNow: () => clock });
  try {
    await h.runtime.recomputeFromStore();
    await h.invoke("polyask:proxy-state", { secret: true });
    await settle();
    await settle();
    assert.equal(h.stub.counts().reads, 1);
    assert.equal(h.auth.secretState(), "unreadable");
    clock += PROXY_SECRET_RETRY_MS;
    assert.equal((await h.invoke("polyask:proxy-state") as ProxyStateView).secret, "unreadable");
    await settle();
    assert.equal(h.stub.counts().reads, 1, "不带 { secret: true } 时即使已满重试间隔也不读盘");
    assert.equal((await h.invoke("polyask:proxy-state", { secret: true }) as ProxyStateView).secret, "unreadable");
    await settle();
    await settle();
    assert.equal(h.stub.counts().reads, 2, "unreadable 时设置卡的显式请求也要交给 refreshSecretState，由它按重试间隔决定是否读盘");
  } finally { h.dispose(); h.database.close(); }
});

test("bursts of runtime changes push one whitelisted state", async () => {
  const h = harness();
  try {
    h.runtime.emit(); h.runtime.emit(); h.runtime.emit();
    await settle();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].channel, "polyask:proxy-state-changed");
    assert.equal("leaked" in (h.sent[0].payload as object), false);
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-set rejects malformed input and passwords before touching anything", async () => {
  const h = harness();
  try {
    const cases: [unknown, string | null][] = [
      [null, "shape"],
      [{ value: P1, extra: true }, "shape"],
      [{ value: { ...P1, host: "proxy-a.example:8080" } }, null],
      [{ value: { ...P1, bypass: ["*.invalid"] } }, null],
      [{ value: P1, password: "" }, "password"],
      [{ value: P1, password: "a\u0000b" }, "password"],
      [{ value: P1, password: "a\u0085b" }, "password"],
      [{ value: P1, password: "x".repeat(1025) }, "password"],
      [{ value: P1, password: 42 }, "password"],
      [{ value: SOCKS, password: "secret" }, "password"],
      [{ value: SYSTEM, password: "secret" }, "password"]
    ];
    for (const [input, field] of cases) {
      const result = await h.invoke("polyask:proxy-set", input) as { ok: boolean; result?: string; field?: string };
      assert.equal(result.ok, false, JSON.stringify(input));
      assert.equal(result.result, "proxy_invalid", JSON.stringify(input));
      if (field) assert.equal(result.field, field, JSON.stringify(input));
    }
    assert.equal(h.runtime.calls.length + h.gate.runs, 0, "校验失败不进 gate、不应用");
    assert.equal(h.database.meta.get(PROXY_OVERRIDE_KEY), null);
    assert.equal(h.database.outbox.count(), 0);
    assert.equal(h.stub.writes.length + h.stub.counts().clears, 0);
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-set normalizes, applies with the credential, then persists the override and the password", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    const result = await h.invoke("polyask:proxy-set", { value: { ...P1, host: " PROXY-A.example " }, password: "pw" });
    assert.deepEqual(result, { ok: true });
    assert.equal(h.gate.runs, 1, "写操作在 OperationGate 内执行");
    assert.deepEqual(h.runtime.calls, [{ target: P1, credential: "pw" }], "先规范化再应用；新凭据随应用交给 runtime");
    assert.deepEqual(h.runtime.applied, P1);
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(h.database.outbox.count(), 0, "不跟随时不上传");
    assert.equal(h.stub.writes.length, 1);
    assert.deepEqual(JSON.parse(h.stub.writes[0]),
      { version: 1, scheme: "http", host: "proxy-a.example", port: 7890, username: "alice", password: "pw" });
  } finally { h.dispose(); h.database.close(); }
});

test("clearing only the password hands null to the runtime even when the value is unchanged", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1 }), { ok: true });
    h.runtime.calls.length = 0;
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1, password: null }), { ok: true });
    assert.deepEqual(h.runtime.calls, [{ target: P1, credential: null }],
      "null 必须交给 applyNow：runtime 据此先 clearAuthCache、装入墓碑，再 setProxy");
    assert.equal(h.stub.counts().clears, 1);
    assert.equal(h.stub.writes.length, 0);
  } finally { h.dispose(); h.database.close(); }
});

test("a failed password write keeps the saved proxy and reports secret failed", async () => {
  const h = harness({ failWrite: true });
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1, password: "pw" }), { ok: true, secret: "failed" });
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1, "密码写盘失败不中止落盘");
  } finally { h.dispose(); h.database.close(); }
});

test("a failed apply writes nothing and never leaves the profile blocked", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1 }), { ok: true });
    h.runtime.failNext = true;
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2, password: "pw2" }), { ok: false, result: "proxy_apply_failed" });
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(h.database.meta.get(PROXY_ACCEPTED_KEY), null);
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), null);
    assert.equal(sharedValue(h), null);
    assert.equal(h.database.outbox.count(), 0);
    assert.equal(h.stub.writes.length, 0, "应用失败不写密码文件");
    assert.equal(classifyProxyInputs(h.store.read()).kind, "resolve", "重启后不会进入阻断");

    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: true }), { ok: true });
    const outbox = h.database.outbox.count();
    h.runtime.failNext = true;
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2 }), { ok: false, result: "proxy_apply_failed" });
    assert.deepEqual(sharedValue(h), P1, "跟随时应用失败也不写 S");
    assert.deepEqual(h.database.meta.get(PROXY_ACCEPTED_KEY), P1);
    assert.equal(h.database.outbox.count(), outbox);
  } finally { h.dispose(); h.database.close(); }
});

test("write channels answer proxy_busy while the gate is held or a local reset runs; probing is not gated", async () => {
  const h = harness();
  const accept = { scheme: "http", host: "proxy-a.example", port: 7890, version: { updatedAt: 1, deviceId: "device-b" } };
  const writes: [string, unknown][] = [
    ["polyask:proxy-set", { value: P1 }], ["polyask:proxy-follow", { enabled: true }],
    ["polyask:proxy-accept", accept], ["polyask:proxy-reload-sites", undefined]
  ];
  try {
    let release!: () => void;
    const running = h.gate.run(() => new Promise<void>(resolve => { release = resolve; }));
    for (const [channel, payload] of writes) assert.deepEqual(await h.invoke(channel, payload), BUSY, channel);
    assert.deepEqual(await h.invoke("polyask:proxy-test", { value: P1, password: "pw" }), { ok: true, ms: 12, route: "proxy" });
    assert.deepEqual(h.probeCalls, [[P1, "pw"]], "测试连接不受 OperationGate 限制");
    release();
    await running;

    h.admin.isResetting = true;
    const runs = h.gate.runs;
    for (const [channel, payload] of writes) assert.deepEqual(await h.invoke(channel, payload), BUSY, channel);
    assert.equal(h.gate.runs, runs, "重置不走 gate：必须在进 gate 之前拦下");
    assert.equal(h.runtime.calls.length + h.reloads.count, 0);
    assert.equal(h.database.meta.get(PROXY_OVERRIDE_KEY), null);
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-test whitelists its input and reload-sites runs inside the gate", async () => {
  const h = harness();
  try {
    for (const input of [null, { value: P1, extra: 1 }, { value: P1, password: null }, { value: P1, password: 7 }]) {
      assert.deepEqual(await h.invoke("polyask:proxy-test", input), { ok: false, result: "proxy_invalid" }, JSON.stringify(input));
    }
    assert.equal(h.probeCalls.length, 0);
    assert.deepEqual(await h.invoke("polyask:proxy-reload-sites"), { ok: true, skipped: ["kimi"] });
    assert.equal(h.reloads.count, 1);
    assert.equal(h.gate.runs, 1, "重新加载会中断正在生成的回答，必须拿到 gate");
  } finally { h.dispose(); h.database.close(); }
});

test("a pending sync confirmation blocks local saves", async () => {
  const h = harness();
  try {
    const pending = await followingWithPending(h);
    const calls = h.runtime.calls.length;
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P3 }), { ok: false, result: "proxy_pending_confirm" });
    assert.equal(h.runtime.calls.length, calls, "本机保存不得顺带确认未经横幅确认的地址");
    assert.deepEqual(h.database.meta.get(PROXY_ACCEPTED_KEY), P2);
    assert.equal((sharedValue(h) as ProxyPreference).host, pending.host);
  } finally { h.dispose(); h.database.close(); }
});

test("following cannot be turned on or off from a blocked profile", async () => {
  const blockedOverride = harness();
  try {
    blockedOverride.database.meta.put(PROXY_OVERRIDE_KEY, { ...P1, host: "PROXY-A.example" });
    await blockedOverride.runtime.recomputeFromStore();
    assert.equal(blockedOverride.runtime.blocked, true);
    assert.deepEqual(await blockedOverride.invoke("polyask:proxy-follow", { enabled: true }), { ok: false, result: "proxy_invalid" });
    assert.equal(blockedOverride.runtime.calls.length, 0);
    assert.equal(blockedOverride.database.meta.get(PROXY_FOLLOWING_KEY), null);
  } finally { blockedOverride.dispose(); blockedOverride.database.close(); }

  const blockedFollowing = harness();
  try {
    blockedFollowing.database.meta.put(PROXY_FOLLOWING_KEY, true);
    await blockedFollowing.runtime.recomputeFromStore();
    assert.equal(blockedFollowing.runtime.blocked, true, "跟随但 A、override 都没有 → 阻断");
    assert.deepEqual(await blockedFollowing.invoke("polyask:proxy-follow", { enabled: false }), { ok: false, result: "proxy_invalid" });
    assert.equal(blockedFollowing.database.meta.get(PROXY_FOLLOWING_KEY), true);
    assert.equal(blockedFollowing.database.meta.get(PROXY_OVERRIDE_KEY), null);
  } finally { blockedFollowing.dispose(); blockedFollowing.database.close(); }
});

test("a failed apply while turning following on leaves following, A and outbox unchanged", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1 }), { ok: true });
    h.runtime.failNext = true;
    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: true }), { ok: false, result: "proxy_apply_failed" });
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), null);
    assert.equal(h.database.meta.get(PROXY_ACCEPTED_KEY), null);
    assert.equal(sharedValue(h), null);
    assert.equal(h.database.outbox.count(), 0);
  } finally { h.dispose(); h.database.close(); }
});

test("follow on, off, local P2, on again compares against P2 instead of the stale A", async () => {
  const h = harness();
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1 }), { ok: true });
    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: true }), { ok: true });
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), true);
    assert.deepEqual(h.database.meta.get(PROXY_ACCEPTED_KEY), P1);
    assert.deepEqual(sharedValue(h), P1, "原本没有 S：打开时把已应用配置作为新版本上传");
    assert.equal(h.database.outbox.count(), 1);

    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: false }), { ok: true });
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), false);
    assert.equal(h.database.meta.get(PROXY_ACCEPTED_KEY), null, "关闭跟随删除 A");

    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2 }), { ok: true });
    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: true }), { ok: true });
    assert.deepEqual(h.runtime.applied, P2, "比较基准是打开那一刻的已应用配置 P2，不是旧 A=P1");
    assert.deepEqual(h.database.meta.get(PROXY_ACCEPTED_KEY), P2);
    assert.equal(h.runtime.pendingConfirm?.host, "proxy-a.example", "云端 S 仍是 P1：地址不同 → 待确认");
    assert.equal(h.database.outbox.count(), 1, "已有 S 时打开跟随不再上传");
  } finally { h.dispose(); h.database.close(); }
});

test("turning following off keeps the confirmed A, never the unconfirmed S", async () => {
  const h = harness();
  try {
    await followingWithPending(h);
    assert.deepEqual(await h.invoke("polyask:proxy-follow", { enabled: false }), { ok: true });
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P2);
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), false);
    assert.equal(h.database.meta.get(PROXY_ACCEPTED_KEY), null);
    assert.deepEqual(h.runtime.applied, P2);
    assert.equal(h.runtime.pendingConfirm, null);
  } finally { h.dispose(); h.database.close(); }
});

test("proxy-accept applies only the exact pending S and rejects stale banners", async () => {
  const h = harness();
  try {
    const pending = await followingWithPending(h);
    const calls = h.runtime.calls.length;
    assert.deepEqual(await h.invoke("polyask:proxy-accept", { ...pending, version: { ...pending.version, updatedAt: 1 } }),
      { ok: false, result: "proxy_not_pending" });
    assert.deepEqual(await h.invoke("polyask:proxy-accept", { ...pending, host: "proxy-c.example" }),
      { ok: false, result: "proxy_not_pending" });
    assert.equal(h.runtime.calls.length, calls);

    // 横幅还显示 P1，同步已把 S 换成 P3：accept(P1) 必须被拒，并刷新横幅。
    h.database.state.put(PROXY_STATE_KEY, { value: P3, updatedAt: 9_500, deviceId: "device-b" }, 9_500, false);
    assert.equal(h.runtime.pendingConfirm?.host, "proxy-a.example");
    assert.deepEqual(await h.invoke("polyask:proxy-accept", pending), { ok: false, result: "proxy_not_pending" });
    assert.equal(h.runtime.calls.length, calls);
    assert.deepEqual(h.runtime.applied, P2);
    const refreshed = h.runtime.pendingConfirm;
    assert.ok(refreshed);
    assert.equal(refreshed.host, "proxy-c.example");

    assert.deepEqual(await h.invoke("polyask:proxy-accept", refreshed), { ok: true });
    assert.deepEqual(h.runtime.calls.at(-1), { target: P3, credential: undefined });
    assert.deepEqual(h.runtime.applied, P3);
    assert.deepEqual(h.database.meta.get(PROXY_ACCEPTED_KEY), P3);
    assert.equal(h.runtime.pendingConfirm, null);
  } finally { h.dispose(); h.database.close(); }
});

test("a corrupted following flag survives generic preference writes and is repaired by proxy-set", async () => {
  const h = harness();
  try {
    h.database.meta.put(PROXY_FOLLOWING_KEY, "yes");
    new PreferencesRepository(h.database.state, h.database.meta).set("siteZoom.kimi", 1.25);
    assert.equal(classifyProxyInputs(h.store.read()).kind, "blocked", "通用偏好写入不得把损坏的跟随标志改回 false");
    await h.runtime.recomputeFromStore();
    assert.equal(h.runtime.blocked, true);
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1 }), { ok: true });
    assert.equal(h.database.meta.get(PROXY_FOLLOWING_KEY), false);
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1);
    assert.equal(classifyProxyInputs(h.store.read()).kind, "resolve", "重启后不再阻断");
    assert.equal(h.runtime.blocked, false);
  } finally { h.dispose(); h.database.close(); }
});

test("a local reset waits for a proxy save stuck in encryption and leaves no proxy data behind", async () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-proxy-ipc-"));
  const secretPath = join(directory, "proxy-secret.bin");
  let started!: () => void;
  let release!: () => void;
  const encrypting = new Promise<void>(resolve => { started = resolve; });
  const crypto: TokenCrypto = {
    backend: () => "gnome_libsecret", available: async () => true,
    encrypt: async value => { started(); await new Promise<void>(resolve => { release = resolve; }); return Buffer.from(value, "utf8"); },
    decrypt: async value => value.toString("utf8")
  };
  const h = harness({ secrets: new SecretFileStore(secretPath, crypto) });
  const admin = new DataAdminService({ database: h.database, deviceId: () => "device-a", wipeSecrets: () => h.runtime.wipeSecrets(),
    sync: { disconnect: async () => status(), status: () => status() } });
  try {
    await h.runtime.recomputeFromStore();
    const saving = h.invoke("polyask:proxy-set", { value: P1, password: "pw" });
    await encrypting;
    const resetting = admin.resetLocal();
    await settle();
    await settle();
    assert.equal(h.runtime.wipes, 0, "重置必须等代理写锁：写盘管线还卡在加密上");
    release();
    assert.deepEqual(await saving, { ok: true });
    await resetting;
    assert.equal(h.runtime.wipes, 1);
    assert.equal(existsSync(secretPath), false, "重置之后密码文件不存在");
    assert.equal(h.auth.secretState(), "unknown", "wiping 结束后缓存回到 null");
    assert.equal(h.database.meta.get(PROXY_OVERRIDE_KEY), null);
    assert.equal(h.database.meta.get(PROXY_ACCEPTED_KEY), null);
    assert.equal(sharedValue(h), null);
    assert.equal(h.database.outbox.count(), 0);
  } finally { h.dispose(); h.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Review Focus 1：Linux 钥匙环锁定或无响应时 encryptStringAsync 永不返回。保存占着 gate 与写锁，不能因此把群发永久挡住。
test("a password save stuck on the keyring ends as secret failed and releases the gate and the write lock", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-proxy-ipc-"));
  const secretPath = join(directory, "proxy-secret.bin");
  let encrypts = 0;
  const crypto: TokenCrypto = {
    backend: () => "gnome_libsecret", available: async () => true,
    encrypt: () => { encrypts += 1; return new Promise<Buffer>(() => {}); },
    decrypt: async value => value.toString("utf8")
  };
  const h = harness({ secrets: new SecretFileStore(secretPath, crypto, { keyringTimeoutMs: 20 }) });
  try {
    await h.runtime.recomputeFromStore();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1, password: "pw" }), { ok: true, secret: "failed" },
      "写盘超时降级为仅本次运行有效（T8 catch → failed），保存流程照常结束");
    assert.equal(encrypts, 1);
    assert.deepEqual(h.runtime.applied, P1, "配置已生效");
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1, "密码写盘超时不中止配置落盘");
    assert.deepEqual(readdirSync(directory), [], "超时不留 tmp，也没有密码文件");
    assert.equal(h.gate.busy, false, "OperationGate 已释放");
    assert.equal(await h.gate.run(async () => "broadcast"), "broadcast", "随后的 gate.run（群发）照常执行，不报 operation_busy");
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2 }), { ok: true }, "代理写锁已释放：下一次保存不被挡住");
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P2, password: null }), { ok: true },
      "清密码的 clear 排在超时的 write 之后，链没有被卡死");
    assert.equal(encrypts, 1, "后两次保存不带新密码，不再碰钥匙环");
    assert.deepEqual(h.runtime.applied, P2);
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P2);
  } finally { h.dispose(); h.database.close(); rmSync(directory, { recursive: true, force: true }); }
});

// Review Focus 1（T7 下游交接）：设置卡挂载触发的惰性读盘卡在 decryptStringAsync 上，用户随即保存密码。
// write 与 read 共用 SecretFileStore 的串行链，只能排在挂起的 read 后面；read 必须由 T7 的钥匙环时限结束，
// 否则 proxy-set 永远占着 gate 与写锁（T8 的 5s 读超时只答复 ProxyAuth 的等待方，不推进链）。
test("a password save queued behind a lazy secret read stuck on the keyring returns in time and releases the gate", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "polyask-proxy-ipc-"));
  const secretPath = join(directory, "proxy-secret.bin");
  writeFileSync(secretPath, "stale-ciphertext");
  let decrypts = 0;
  let decrypting!: () => void;
  const reading = new Promise<void>(resolve => { decrypting = resolve; });
  const crypto: TokenCrypto = {
    backend: () => "gnome_libsecret", available: async () => true,
    encrypt: async value => Buffer.from(value, "utf8"),
    decrypt: () => { decrypts += 1; decrypting(); return new Promise<string>(() => {}); }
  };
  const h = harness({ secrets: new SecretFileStore(secretPath, crypto, { keyringTimeoutMs: 20 }) });
  try {
    await h.runtime.recomputeFromStore();
    const view = await h.invoke("polyask:proxy-state", { secret: true }) as ProxyStateView;
    assert.equal(view.secret, "unknown", "惰性读盘在后台进行，先报 unknown");
    await reading;
    assert.equal(decrypts, 1, "读盘已进入 decrypt，并卡在钥匙环上");

    const started = Date.now();
    assert.deepEqual(await h.invoke("polyask:proxy-set", { value: P1, password: "pw" }), { ok: true },
      "排队的 write 在挂起的 read 超时（unreadable）后照常加密落盘");
    assert.ok(Date.now() - started < 2_000, "只等了 T7 的钥匙环时限（注入 20ms），没有等 T8 的 5s 读超时");
    assert.equal(h.gate.busy, false, "OperationGate 已释放");
    assert.equal(await h.gate.run(async () => "broadcast"), "broadcast", "随后的 gate.run（群发）照常执行，不报 operation_busy");

    assert.deepEqual(readdirSync(directory), ["proxy-secret.bin"], "不留 tmp");
    assert.deepEqual(JSON.parse(readFileSync(secretPath, "utf8")),
      { version: 1, scheme: "http", host: "proxy-a.example", port: 7890, username: "alice", password: "pw" },
      "新密码替换了旧文件：超时的 read 只记 unreadable，绝不 unlink，也不挡住后面的 write");
    assert.equal(decrypts, 1, "保存不再读盘");
    assert.deepEqual(h.runtime.applied, P1);
    assert.deepEqual(h.database.meta.get(PROXY_OVERRIDE_KEY), P1);
  } finally { h.dispose(); h.database.close(); rmSync(directory, { recursive: true, force: true }); }
});
