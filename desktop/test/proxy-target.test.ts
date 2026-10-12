import assert from "node:assert/strict";
import test from "node:test";

import { resolveProxyTarget, type ProxyTargetInput, type VersionedProxy } from "../src/main/proxy-target";
import { DEFAULT_PROXY_PREFERENCE, type ProxyPreference } from "../src/shared/proxy-preference";

function proxy(patch: Partial<ProxyPreference> = {}): ProxyPreference {
  return { version: 1, mode: "custom", scheme: "http", host: "proxy-a.example", port: 7890, bypass: [], username: "", ...patch };
}

function shared(value: ProxyPreference, updatedAt = 500, deviceId = "device-b"): VersionedProxy {
  return { value, updatedAt, deviceId };
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// 纯函数：输入深冻结，任何就地修改都会在严格模式下抛错。
function resolve(input: ProxyTargetInput) {
  return resolveProxyTarget(freeze(structuredClone(input)));
}

const P1 = proxy();
const P2 = proxy({ host: "proxy-b.example" });
const SYSTEM = proxy({ mode: "system" });
const DIRECT = proxy({ mode: "direct" });

test("not following uses the local override and never proposes an accepted value", () => {
  assert.deepEqual(resolve({ following: false, override: P1, shared: shared(P2), accepted: P2 }),
    { target: P1, pendingConfirm: null, nextAccepted: null });
});

test("not following without an override falls back to the system default", () => {
  const result = resolve({ following: false, override: null, shared: null, accepted: null });
  assert.deepEqual(result.target, DEFAULT_PROXY_PREFERENCE);
  assert.equal(result.target.mode, "system");
  assert.equal(result.pendingConfirm, null);
  assert.equal(result.nextAccepted, null);
});

test("following without a shared value keeps the base: accepted first, then override", () => {
  assert.deepEqual(resolve({ following: true, override: P2, shared: null, accepted: P1 }),
    { target: P1, pendingConfirm: null, nextAccepted: P1 });
  assert.deepEqual(resolve({ following: true, override: P2, shared: null, accepted: null }),
    { target: P2, pendingConfirm: null, nextAccepted: P2 });
});

test("following adopts shared system or direct modes without confirmation", () => {
  for (const value of [SYSTEM, DIRECT, DEFAULT_PROXY_PREFERENCE]) {
    assert.deepEqual(resolve({ following: true, override: null, shared: shared(value), accepted: P1 }),
      { target: value, pendingConfirm: null, nextAccepted: value });
  }
});

test("following adopts shared custom values that only change bypass or username", () => {
  for (const value of [proxy({ bypass: ["*.corp.example"] }), proxy({ username: "alice" }), P1]) {
    assert.deepEqual(resolve({ following: true, override: null, shared: shared(value), accepted: P1 }),
      { target: value, pendingConfirm: null, nextAccepted: value });
  }
});

test("following holds the base and asks for confirmation when the shared route changes", () => {
  for (const value of [P2, proxy({ port: 7891 }), proxy({ scheme: "https" }), proxy({ scheme: "socks5" })]) {
    assert.deepEqual(resolve({ following: true, override: null, shared: shared(value, 900, "device-c"), accepted: P1 }), {
      target: P1,
      nextAccepted: P1,
      pendingConfirm: { scheme: value.scheme, host: value.host, port: value.port, version: { updatedAt: 900, deviceId: "device-c" } }
    });
  }
});

test("a shared custom route needs confirmation whenever the base is not custom, even with equal host fields", () => {
  for (const base of [SYSTEM, DIRECT]) {
    const result = resolve({ following: true, override: null, shared: shared(P1), accepted: base });
    assert.deepEqual(result.target, base);
    assert.deepEqual(result.nextAccepted, base);
    assert.deepEqual(result.pendingConfirm,
      { scheme: "http", host: "proxy-a.example", port: 7890, version: { updatedAt: 500, deviceId: "device-b" } });
  }
});

test("the follow-on call compares against the applied value and ignores a stale accepted value", () => {
  const stale = proxy({ host: "stale.example" });
  assert.deepEqual(resolve({ following: true, override: stale, shared: null, accepted: stale, appliedAtFollowOn: P2 }),
    { target: P2, pendingConfirm: null, nextAccepted: P2 });
  const pending = resolve({ following: true, override: stale, shared: shared(stale), accepted: stale, appliedAtFollowOn: P2 });
  assert.deepEqual(pending.target, P2);
  assert.equal(pending.pendingConfirm?.host, "stale.example");
  const renamed = proxy({ host: "proxy-b.example", username: "bob" });
  assert.deepEqual(resolve({ following: true, override: null, shared: shared(renamed), accepted: stale, appliedAtFollowOn: P2 }),
    { target: renamed, pendingConfirm: null, nextAccepted: renamed });
});

test("following without any base throws instead of opening a route", () => {
  assert.throws(() => resolve({ following: true, override: null, shared: shared(P1), accepted: null }), /proxy_target_unresolved/);
  assert.throws(() => resolve({ following: true, override: null, shared: null, accepted: null }), /proxy_target_unresolved/);
});
