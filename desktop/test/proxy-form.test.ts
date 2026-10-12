import assert from "node:assert/strict";
import test from "node:test";

import { COPY, getCopy } from "../src/shared/copy";
import { describeProxyField, describeProxyResult, PROXY_COPY, proxyModeLabel } from "../src/shared/proxy-copy";
import { DEFAULT_PROXY_PREFERENCE, type ProxyPreference } from "../src/shared/proxy-preference";
import {
  checkProxyForm, formFromPreference, hostLooksCombined, isLoopbackHost, isProxyStateView, passwordProblem, pendingKey, proxyEndpoint,
  proxyErrorCode, proxyFormHints, proxyOutcome, proxyReloadOutcome, proxyRequest, proxyStateEndpoint, proxyTestOutcome, rawFromForm,
  sameProxyForm
} from "../src/renderer/proxy-form";
import { customProxy, proxyStateFixture } from "./ui/proxy-state-fixture";

const PROXY_CODES = ["proxy_invalid", "proxy_busy", "proxy_apply_failed", "proxy_secret_failed", "proxy_test_busy",
  "proxy_not_pending", "proxy_pending_confirm", "proxy_failed", "proxy_auth_failed", "network_error", "network_timeout"];

test("proxy copy is merged into every locale with matching placeholders", () => {
  const keys = Object.keys(PROXY_COPY.en).sort();
  assert.deepEqual(Object.keys(PROXY_COPY.zhCN).sort(), keys);
  assert.deepEqual(Object.keys(PROXY_COPY.zhTW).sort(), keys);
  for (const locale of Object.values(COPY)) {
    const merged = locale as unknown as Record<string, string>;
    for (const key of keys) {
      const english = (PROXY_COPY.en as Record<string, string>)[key];
      assert.equal(typeof merged[key], "string", `${key} must be merged into COPY`);
      assert.deepEqual([...merged[key].matchAll(/\{[A-Za-z]+\}/g)].map(String).sort(),
        [...english.matchAll(/\{[A-Za-z]+\}/g)].map(String).sort(), `${key} placeholders`);
    }
  }
});

test("every proxy IPC and test code has its own message and unknown codes never leak", () => {
  const copy = getCopy("zh-CN");
  const messages = PROXY_CODES.map(code => describeProxyResult(copy, code));
  for (const [index, message] of messages.entries()) {
    assert.notEqual(message, copy.proxyResultUnknown, `${PROXY_CODES[index]} needs dedicated copy`);
    assert.doesNotMatch(message, /[a-z]+_[a-z]+/, "machine codes are never shown");
  }
  assert.equal(describeProxyResult(copy, "proxy_secret_failed"), copy.proxySavedSecretFailed);
  assert.equal(describeProxyResult(copy, "proxy_pending_confirm"), copy.proxySaveBlockedPending);
  assert.equal(describeProxyResult(copy, "constructor"), copy.proxyResultUnknown);
  assert.equal(describeProxyResult(copy, null), copy.proxyResultUnknown);
  assert.equal(describeProxyField(copy, "password"), copy.proxyErrorPassword);
  for (const locale of Object.values(COPY)) {
    // spec §4.5：要求重新输入密码的文案都必须带 host:port；不带端点的通用码文案不得索要密码。
    assert.match(locale.proxyAuthRejected, /\{endpoint\}/);
    assert.match(locale.proxySecretReenter, /\{endpoint\}/);
    assert.doesNotMatch(locale.proxyResultAuthFailed, /password|密码|密碼/i);
  }
  assert.deepEqual(["system", "direct", "custom"].map(mode => proxyModeLabel(copy, mode as ProxyPreference["mode"])), ["跟随系统", "不使用代理", "自定义"]);
});

test("form values round-trip through the same three-step check as the IPC entry", () => {
  const form = formFromPreference({ ...customProxy, bypass: ["*.example.com", "10.0.0.0/8"] });
  assert.deepEqual(form, { mode: "custom", scheme: "http", host: "proxy.example", port: "8080", bypass: "*.example.com\n10.0.0.0/8", username: "alice" });
  const checked = checkProxyForm({ ...form, host: " Proxy.Example ", bypass: " *.example.com \n\n10.0.0.0/8\n*.example.com" }, DEFAULT_PROXY_PREFERENCE);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.deepEqual(checked.value, { ...customProxy, bypass: ["*.example.com", "10.0.0.0/8"] });
  assert.deepEqual(checkProxyForm({ ...form, host: "proxy.example:8080" }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "host" });
  assert.deepEqual(checkProxyForm({ ...form, port: "80a" }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "port" });
  assert.deepEqual(checkProxyForm({ ...form, port: "" }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "port" });
  assert.deepEqual(checkProxyForm({ ...form, bypass: "*" }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "bypass" });
  assert.deepEqual(checkProxyForm({ ...form, bypass: "*.invalid" }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "bypass" });
  const raw = rawFromForm({ ...form, scheme: "socks5", username: "alice" }) as Record<string, unknown>;
  assert.equal(raw.username, "", "SOCKS never carries a username");
  assert.deepEqual(Object.keys(raw).sort(), ["bypass", "host", "mode", "port", "scheme", "username", "version"]);
});

test("pasted URLs and host:port are recognized for the host message, and drafts compare field by field", () => {
  // Review Focus 3：识别只决定提示文案；这些输入仍由 checkProxyInput 按 host 字段拒收（见下方断言），不被截断。
  const pasted = ["http://127.0.0.1:7890", "127.0.0.1:7890", " 127.0.0.1:7890 ", "[::1]:7890", "proxy.example:", "socks5://proxy.example",
    "user@proxy.example", "proxy.example/path"];
  for (const host of pasted) {
    assert.equal(hostLooksCombined(host), true, host);
    assert.deepEqual(checkProxyForm({ ...formFromPreference(customProxy), host }, DEFAULT_PROXY_PREFERENCE), { ok: false, field: "host" }, host);
  }
  for (const host of ["127.0.0.1", "proxy.example", "::1", "[::1]", "fe80::a", "proxy example", ""]) assert.equal(hostLooksCombined(host), false, host);
  const form = formFromPreference(customProxy);
  assert.equal(sameProxyForm(form, { ...form }), true);
  for (const patch of [{ mode: "system" as const }, { scheme: "https" as const }, { host: "other.example" }, { port: "8081" }, { bypass: "*.lan" }, { username: "bob" }]) {
    assert.equal(sameProxyForm(form, { ...form, ...patch }), false, JSON.stringify(patch));
  }
});

test("switching to a non-custom mode keeps the last accepted custom fields when hidden edits are invalid", () => {
  const accepted = { ...customProxy };
  const broken = { ...formFromPreference(accepted), host: "bad host", mode: "system" as const };
  const checked = checkProxyForm(broken, accepted);
  assert.equal(checked.ok, true);
  if (checked.ok) assert.deepEqual(checked.value, { ...accepted, mode: "system" });
  assert.deepEqual(checkProxyForm({ ...broken, mode: "custom" }, accepted), { ok: false, field: "host" });
});

test("password requests follow the undefined / string contract and never carry SOCKS or empty passwords", () => {
  assert.equal("password" in proxyRequest(customProxy, null), false, "untouched field sends nothing");
  assert.equal("password" in proxyRequest(customProxy, ""), false, "an emptied field means no change, never \"\"");
  assert.deepEqual(proxyRequest(customProxy, "s3cret"), { value: customProxy, password: "s3cret" });
  assert.equal("password" in proxyRequest({ ...customProxy, scheme: "socks5", username: "" }, "s3cret"), false);
  assert.equal("password" in proxyRequest({ ...customProxy, mode: "direct" }, "s3cret"), false);
  assert.equal(passwordProblem(null), false);
  assert.equal(passwordProblem("x".repeat(1024)), false);
  assert.equal(passwordProblem("x".repeat(1025)), true);
  assert.equal(passwordProblem("a\u0000b"), true);
  assert.equal(passwordProblem("a\u0085b"), true, "C1 controls follow the shared T3 check");
});

test("form hints follow protocol, credentials, loopback and the Linux proxy source", () => {
  const form = formFromPreference(customProxy);
  assert.deepEqual(proxyFormHints(form, null), { socks: false, socks4Dns: false, plaintext: true, linuxEnv: false });
  assert.equal(proxyFormHints({ ...form, host: "127.0.0.1" }, null).plaintext, false);
  assert.equal(proxyFormHints({ ...form, host: "[::1]" }, null).plaintext, false);
  assert.equal(proxyFormHints({ ...form, scheme: "https" }, null).plaintext, false);
  assert.equal(proxyFormHints({ ...form, username: "" }, null).plaintext, false);
  assert.deepEqual(proxyFormHints({ ...form, scheme: "socks4" }, null), { socks: true, socks4Dns: true, plaintext: false, linuxEnv: false });
  assert.equal(proxyFormHints({ ...form, mode: "system" }, "env").linuxEnv, true);
  assert.equal(proxyFormHints({ ...form, mode: "system" }, "desktop").linuxEnv, false);
  assert.equal(proxyFormHints({ ...form, mode: "custom" }, "env").linuxEnv, false);
  assert.equal(proxyFormHints({ ...form, mode: "direct" }, "env").linuxEnv, false);
  assert.deepEqual(["localhost", "LOCALHOST", "app.localhost", "127.8.9.10", "::1", "proxy.example", "10.0.0.1"].map(isLoopbackHost),
    [true, true, true, true, true, false, false]);
  assert.equal(proxyEndpoint({ host: "::1", port: 7890 }), "[::1]:7890");
  assert.equal(proxyEndpoint({ host: "proxy.example", port: 8080 }), "proxy.example:8080");
  assert.equal(proxyStateEndpoint(proxyStateFixture({ applied: customProxy, formValue: DEFAULT_PROXY_PREFERENCE })), "proxy.example:8080",
    "the applied custom proxy names the endpoint");
  assert.equal(proxyStateEndpoint(proxyStateFixture({ applied: null, formValue: { ...customProxy, port: 3128 } })), "proxy.example:3128");
});

test("IPC replies and thrown codes are normalized without trusting their shape", () => {
  assert.deepEqual(proxyOutcome({ ok: true }), { ok: true, secretFailed: false });
  assert.deepEqual(proxyOutcome({ ok: true, secret: "failed" }), { ok: true, secretFailed: true });
  assert.deepEqual(proxyOutcome({ ok: false, result: "proxy_busy" }), { ok: false, code: "proxy_busy" });
  assert.deepEqual(proxyOutcome([]), { ok: false, code: null });
  assert.deepEqual(proxyTestOutcome({ ok: true, ms: 41.6, route: "direct" }), { ok: true, ms: 42, route: "direct" });
  assert.deepEqual(proxyTestOutcome({ ok: true, ms: 5, route: "elsewhere" }), { ok: false, code: null });
  assert.deepEqual(proxyTestOutcome({ ok: false, result: "network_timeout" }), { ok: false, code: "network_timeout" });
  assert.equal(proxyErrorCode(new Error("proxy_pending_confirm")), "proxy_pending_confirm");
  assert.equal(proxyErrorCode(new Error("Error invoking remote method")), null);
  assert.equal(proxyErrorCode("proxy_busy"), null);
  assert.deepEqual(proxyReloadOutcome({ ok: true, skipped: ["kimi"] }), { ok: true, skipped: ["kimi"] });
  assert.deepEqual(proxyReloadOutcome({ ok: false, result: "proxy_busy" }), { ok: false, code: "proxy_busy" });
  assert.deepEqual(proxyReloadOutcome({ ok: true, skipped: [1] }), { ok: false, code: null });
  assert.deepEqual(proxyReloadOutcome({ skipped: ["kimi"] }), { ok: false, code: null }, "replies without ok are not trusted");
  assert.deepEqual(proxyReloadOutcome(undefined), { ok: false, code: null });
});

test("proxy-state payloads are shape-checked and pending versions have a stable key", () => {
  const pending = { scheme: "socks5" as const, host: "new.example", port: 1080, version: { updatedAt: 7, deviceId: "remote" } };
  assert.equal(isProxyStateView(proxyStateFixture()), true);
  assert.equal(isProxyStateView(proxyStateFixture({ pendingConfirm: pending, following: true })), true);
  assert.equal(isProxyStateView([]), false);
  assert.equal(isProxyStateView({ ...proxyStateFixture(), formValue: { ...customProxy, host: "UPPER.example" } }), false, "non-canonical values are rejected");
  assert.equal(isProxyStateView({ ...proxyStateFixture(), secret: "plaintext" }), false);
  assert.equal(isProxyStateView(proxyStateFixture({ authFailed: true })), true);
  const { authFailed: _dropped, ...withoutBreaker } = proxyStateFixture();
  assert.equal(isProxyStateView(withoutBreaker), false, "authFailed is required (T14 wire format)");
  assert.equal(isProxyStateView({ ...proxyStateFixture(), authFailed: "yes" }), false);
  assert.equal(isProxyStateView({ ...proxyStateFixture(), pendingConfirm: { ...pending, version: null } }), false);
  assert.equal(pendingKey(proxyStateFixture()), null);
  assert.equal(pendingKey(proxyStateFixture({ pendingConfirm: pending })), pendingKey(proxyStateFixture({ pendingConfirm: { ...pending } })));
  assert.notEqual(pendingKey(proxyStateFixture({ pendingConfirm: pending })),
    pendingKey(proxyStateFixture({ pendingConfirm: { ...pending, version: { updatedAt: 8, deviceId: "remote" } } })));
});
