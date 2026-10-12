import assert from "node:assert/strict";
import test from "node:test";
import {
  BLOCKING_PROXY_CONFIG, DEFAULT_PROXY_PREFERENCE, PROXY_BYPASS_MAX_RULES, PROXY_CHECK_HOST, PROXY_CHECK_URL,
  bypassMatchesHost, checkProxyInput, expectedResolve, isProxyPreference, normalizeProxyPreference, proxyIdentity,
  proxyPasswordProblem, sameIdentity, sameRoute, toProxyConfig, type ProxyField, type ProxyPreference, type ProxyRoute
} from "../src/shared/proxy-preference";

const FIELD_ORDER = ["version", "mode", "scheme", "host", "port", "bypass", "username"];
const custom = (patch: Partial<ProxyPreference> = {}): ProxyPreference => ({
  version: 1, mode: "custom", scheme: "http", host: "127.0.0.1", port: 7890, bypass: [], username: "", ...patch
});
const rejects = (raw: unknown, field: ProxyField, label: string) => {
  const result = checkProxyInput(raw);
  assert.equal(result.ok, false, `${label} must be rejected`);
  if (!result.ok) assert.equal(result.field, field, `${label} reports ${field}`);
};
const accepts = (raw: unknown, label: string): ProxyPreference => {
  const result = checkProxyInput(raw);
  assert.equal(result.ok, true, `${label} must be accepted`);
  if (!result.ok) throw new Error(`unreachable: ${label}`);
  return result.value;
};

test("default and host-less system/direct values validate and normalize idempotently", () => {
  assert.equal(isProxyPreference(DEFAULT_PROXY_PREFERENCE), true);
  assert.deepEqual(normalizeProxyPreference(DEFAULT_PROXY_PREFERENCE), DEFAULT_PROXY_PREFERENCE);
  assert.deepEqual({ ...DEFAULT_PROXY_PREFERENCE }, {
    version: 1, mode: "system", scheme: "http", host: "", port: 0, bypass: [], username: ""
  });
  assert.equal(Object.isFrozen(DEFAULT_PROXY_PREFERENCE), true);
  assert.equal(Object.isFrozen(DEFAULT_PROXY_PREFERENCE.bypass), true);
  for (const mode of ["system", "direct"] as const) {
    const value = custom({ mode, host: "", port: 0 });
    assert.equal(isProxyPreference(value), true, `${mode} with empty host`);
    assert.deepEqual(accepts(value, `${mode} with empty host`), value);
  }
  const kept = custom({ mode: "direct", host: "proxy.example", port: 8080, username: "alice", bypass: ["*.lan"] });
  assert.equal(isProxyPreference(kept), true, "switching mode keeps the custom fields");
});

test("IPC input is checked, normalized into canonical field order, and stays idempotent", () => {
  const value = accepts({
    username: "alice", bypass: [" *.Example.com ", "", "*.Example.com", "10.0.0.0/8", "  "], port: 8080,
    host: "  Proxy.Example.COM ", scheme: "http", mode: "custom", version: 1
  }, "messy but legal input");
  assert.deepEqual(value, custom({ host: "proxy.example.com", port: 8080, bypass: ["*.Example.com", "10.0.0.0/8"], username: "alice" }));
  assert.deepEqual(Object.keys(value), FIELD_ORDER);
  assert.equal(isProxyPreference(value), true);
  assert.equal(JSON.stringify(normalizeProxyPreference(value)), JSON.stringify(value), "normalizing twice changes nothing");
  assert.equal(accepts(custom({ scheme: "socks5", username: "alice" }), "socks with username").username, "",
    "SOCKS drops the username during normalization");
  assert.equal(accepts(custom({ host: "127.1" }), "short IPv4").host, "127.0.0.1");
});

test("IPv6 literals and IDN hosts normalize to one canonical form", () => {
  for (const host of ["::1", "[::1]", " [::1] "]) assert.equal(accepts(custom({ host }), host).host, "::1", host);
  assert.equal(accepts(custom({ host: "FE80::A" }), "upper IPv6").host, "fe80::a");
  assert.equal(accepts(custom({ host: "[2001:DB8::1]" }), "bracketed upper IPv6").host, "2001:db8::1");
  assert.equal(accepts(custom({ host: "Bücher.Example" }), "IDN").host, "xn--bcher-kva.example");
  const ipv6 = accepts(custom({ host: "[::1]" }), "loopback IPv6");
  assert.equal(isProxyPreference(ipv6), true);
  assert.equal(toProxyConfig(ipv6).proxyRules, "http://[::1]:7890");
  assert.equal(expectedResolve(ipv6), "PROXY [::1]:7890");
  assert.equal(isProxyPreference(custom({ host: "[::1]" })), false, "stored values must not keep brackets");
  assert.equal(isProxyPreference(custom({ host: "FE80::A" })), false, "stored values must be lower case");
});

test("malformed shapes are rejected as shape", () => {
  const { username: _username, ...missing } = custom();
  const cases: Array<[unknown, string]> = [
    [null, "null"], [undefined, "undefined"], ["custom", "string"], [[], "array"], [missing, "missing field"],
    [{ ...custom(), extra: true }, "extra field"], [{ ...custom(), version: 2 }, "version 2"],
    [{ ...custom(), mode: "pac_script" }, "unknown mode"], [{ ...custom(), scheme: "socks" }, "unknown scheme"],
    [{ ...custom(), host: 1 }, "numeric host"], [{ ...custom(), port: "7890" }, "string port"],
    [{ ...custom(), bypass: "*.lan" }, "string bypass"], [{ ...custom(), bypass: ["*.lan", 1] }, "non-string rule"],
    [{ ...custom(), bypass: new Array(3) }, "sparse bypass"], [{ ...custom(), username: null }, "null username"]
  ];
  for (const [raw, label] of cases) rejects(raw, "shape", label);
});

test("out-of-range ports and illegal hosts are rejected by field", () => {
  for (const port of [0, 65_536, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) rejects(custom({ port }), "port", `custom port ${port}`);
  for (const port of [-1, 65_536, 0.5]) rejects(custom({ mode: "system", port }), "port", `system port ${port}`);
  const hosts = [
    "", "   ", "host:8080", "proxy.example:8080", "u@h", "user:pw@h", "a b", "a\tb", "a\u0000b", "a\u007fb",
    "h/x", "h?x", "h#x", "h\\x", "[example.com]", "[::1", "::1]", "1.2.3.4.5", "x".repeat(254),
    "*", "a,b", "a;b", "127.0.0.1,direct://", "a|b"
  ];
  for (const host of hosts) rejects(custom({ host }), "host", `host ${JSON.stringify(host)}`);
});

test("pasting a URL, host:port or user@host into the host field is a host error, never silently stripped", () => {
  const pasted = [
    "http://127.0.0.1:7890", "127.0.0.1:7890", "user@host", "socks5://127.0.0.1:1080", "https://proxy.example",
    "http://user:pw@proxy.example:3128/", "[::1]:7890", "proxy.example:3128", " http://127.0.0.1:7890 "
  ];
  for (const host of pasted) {
    rejects(custom({ host }), "host", `pasted ${JSON.stringify(host)}`);
    rejects(custom({ mode: "direct", host }), "host", `pasted ${JSON.stringify(host)} in direct mode`);
    assert.throws(() => normalizeProxyPreference(custom({ host })), `normalize must not strip ${JSON.stringify(host)}`);
    assert.equal(isProxyPreference(custom({ host })), false, `stored ${JSON.stringify(host)}`);
  }
  for (const host of ["127.0.0.1", "host", "proxy.example"]) {
    assert.equal(accepts(custom({ host }), host).host, host, `${host} stays as typed`);
  }
});

test("bypass rules that would make everything direct or blind the apply check are rejected", () => {
  const rules = [
    "*", "*.*", "**", "*.invalid", ".invalid", "*polyask*", ".polyask.invalid", PROXY_CHECK_HOST,
    PROXY_CHECK_HOST.toUpperCase(), "proxy?check.polyask.invalid", "https://*", "*:443",
    "<local>", "<-loopback>", "a,b", "*.lan;*", "a b", "a\tb", "a\u0001b", "x".repeat(254)
  ];
  for (const rule of rules) rejects(custom({ bypass: ["*.lan", rule] }), "bypass", `bypass ${JSON.stringify(rule)}`);
  const many = Array.from({ length: PROXY_BYPASS_MAX_RULES + 1 }, (_, index) => `h${index}.lan`);
  rejects(custom({ bypass: many }), "bypass", "65 distinct rules");
  const duplicates = [...Array.from({ length: PROXY_BYPASS_MAX_RULES }, (_, index) => `h${index}.lan`), "h0.lan", " h1.lan "];
  assert.equal(accepts(custom({ bypass: duplicates }), "64 rules after dedupe").bypass.length, PROXY_BYPASS_MAX_RULES);
  const huge: string[] = []; huge.length = 2 ** 32 - 1;
  rejects(custom({ bypass: huge }), "bypass", "giant sparse array is capped before copying");
  for (const rule of ["*.com", "*.gstatic.com", "localhost", "10.0.0.0/8", "[::1]", "192.168.*", "*.example.com"]) {
    assert.deepEqual(accepts(custom({ bypass: [rule] }), rule).bypass, [rule], `${rule} stays allowed`);
  }
});

test("usernames with control characters or over 255 characters are rejected", () => {
  for (const username of ["a\u0001", "a\u007f", "a\nb", "x".repeat(256)]) rejects(custom({ username }), "username", JSON.stringify(username));
  assert.equal(accepts(custom({ username: "x".repeat(255) }), "255 chars").username.length, 255);
});

test("isProxyPreference rejects non-canonical stored values", () => {
  const nonCanonical: Array<[unknown, string]> = [
    [custom({ host: "Proxy.Example" }), "upper-case host"], [custom({ host: " proxy.example" }), "untrimmed host"],
    [custom({ bypass: [" *.lan"] }), "untrimmed rule"], [custom({ bypass: ["*.lan", "*.lan"] }), "duplicate rule"],
    [custom({ bypass: [""] }), "empty rule"], [custom({ scheme: "socks5", username: "alice" }), "socks username"],
    [custom({ host: "127.1" }), "short IPv4"], [custom({ host: "bücher.example" }), "unicode host"],
    [custom({ host: "*" }), "wildcard host"], [custom({ bypass: ["*"] }), "bare star"],
    [{ mode: "custom", version: 1, scheme: "http", host: "127.0.0.1", port: 7890, bypass: [], username: "" }, "shuffled field order"]
  ];
  for (const [value, label] of nonCanonical) assert.equal(isProxyPreference(value), false, label);
});

test("isProxyPreference and checkProxyInput never throw on hostile input", () => {
  const throwingGetter: Record<string, unknown> = { ...custom() };
  Object.defineProperty(throwingGetter, "host", { enumerable: true, get() { throw new Error("boom"); } });
  const hostileProxy = new Proxy({}, {
    ownKeys() { throw new Error("boom"); },
    get() { throw new Error("boom"); }
  });
  const cyclic: Record<string, unknown> = { ...custom() }; cyclic.self = cyclic;
  const throwingBypass = custom({ bypass: new Proxy(["*.lan"], { get() { throw new Error("boom"); } }) });
  const inputs: unknown[] = [
    undefined, null, 0, 1n, Symbol("proxy"), () => custom(), Number.NaN, "", throwingGetter, hostileProxy,
    cyclic, throwingBypass, Object.create(null), custom({ host: "\ud800" })
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => isProxyPreference(input));
    assert.doesNotThrow(() => checkProxyInput(input));
    assert.equal(isProxyPreference(input), false);
    assert.equal(checkProxyInput(input).ok, false);
  }
});

test("bypassMatchesHost follows the Chromium wildcard subset, conservatively on scheme and port", () => {
  for (const rule of [
    "*", "*.*", "**", "*.invalid", ".invalid", "*polyask*", ".polyask.invalid", PROXY_CHECK_HOST, "PROXY-CHECK.polyask.INVALID",
    "proxy?check.polyask.invalid", "https://*", "http://*.invalid:80", "*:443", " *.invalid "
  ]) assert.equal(bypassMatchesHost(rule, PROXY_CHECK_HOST), true, rule);
  for (const rule of [
    "*.com", "*.gstatic.com", "localhost", "10.0.0.0/8", "[::1]", "*.polyask.invalid.example", "proxy-check",
    "polyask.invalid", "<local>", "", "*.example.com", "*:abc"
  ]) assert.equal(bypassMatchesHost(rule, PROXY_CHECK_HOST), false, rule);
  assert.equal(bypassMatchesHost("*.example.com", "a.example.com"), true);
  assert.equal(bypassMatchesHost("*.example.com", "example.com"), false);
  assert.equal(bypassMatchesHost(".example.com", "a.b.example.com"), true);
  assert.equal(bypassMatchesHost("example.com", "example.com"), true);
  assert.equal(bypassMatchesHost(`${"*a".repeat(120)}z`, "a".repeat(253)), false, "pathological glob stays bounded");
  assert.equal(new URL(PROXY_CHECK_URL).hostname, PROXY_CHECK_HOST);
});

test("toProxyConfig and expectedResolve translate every mode and scheme", () => {
  const system = custom({ mode: "system", host: "", port: 0 });
  const direct = custom({ mode: "direct", host: "proxy.example", port: 8080 });
  assert.deepEqual(toProxyConfig(system), { mode: "system" });
  assert.equal(expectedResolve(system), null);
  assert.deepEqual(toProxyConfig(direct), { mode: "direct" });
  assert.equal(expectedResolve(direct), "DIRECT");
  assert.deepEqual(toProxyConfig(custom({ bypass: ["*.example.com", "10.0.0.0/8"] })), {
    mode: "fixed_servers", proxyRules: "http://127.0.0.1:7890", proxyBypassRules: "*.example.com,10.0.0.0/8,<local>"
  });
  assert.equal(toProxyConfig(custom()).proxyBypassRules, "<local>", "<local> is always appended");
  const expected: Array<[ProxyPreference["scheme"], string, string]> = [
    ["http", "http://proxy.example:3128", "PROXY proxy.example:3128"],
    ["https", "https://proxy.example:3128", "HTTPS proxy.example:3128"],
    ["socks4", "socks4://proxy.example:3128", "SOCKS proxy.example:3128"],
    ["socks5", "socks5://proxy.example:3128", "SOCKS5 proxy.example:3128"]
  ];
  for (const [scheme, rules, resolved] of expected) {
    const value = custom({ scheme, host: "proxy.example", port: 3128 });
    assert.equal(toProxyConfig(value).proxyRules, rules, scheme);
    assert.equal(expectedResolve(value), resolved, scheme);
  }
  assert.deepEqual({ ...BLOCKING_PROXY_CONFIG }, { mode: "fixed_servers", proxyRules: "http://127.0.0.1:9" });
  assert.equal(Object.isFrozen(BLOCKING_PROXY_CONFIG), true);
});

test("identity and route comparisons only consider custom proxies", () => {
  const base = custom({ host: "proxy.example", port: 3128, username: "alice" });
  assert.equal(proxyIdentity(custom({ mode: "system" })), null);
  assert.equal(proxyIdentity(null), null);
  assert.deepEqual(proxyIdentity(base), { scheme: "http", host: "proxy.example", port: 3128, username: "alice" });
  assert.equal(sameIdentity(base, { ...base, bypass: ["*.lan"] }), true, "bypass is not identity");
  assert.equal(sameIdentity(base, { ...base, username: "bob" }), false);
  assert.equal(sameIdentity(base, { ...base, port: 3129 }), false);
  assert.equal(sameIdentity(base, { ...base, scheme: "https" }), false);
  assert.equal(sameIdentity(base, { ...base, mode: "direct" }), false);
  assert.equal(sameIdentity(custom({ mode: "system" }), custom({ mode: "direct" })), true, "no identity on either side");
  assert.equal(sameIdentity(null, DEFAULT_PROXY_PREFERENCE), true);
  const renamed: ProxyPreference = { ...base, username: "bob", bypass: ["*.lan"] };
  assert.equal(sameRoute(base, renamed), true, "route ignores username and bypass");
  const moved: ProxyPreference = { ...base, host: "other.example" };
  assert.equal(sameRoute(base, moved), false);
  const route: ProxyRoute = { scheme: "http", host: "proxy.example", port: 3128 };
  assert.equal(sameRoute(base, route), true);
  const identity = proxyIdentity(base);
  assert.ok(identity);
  assert.equal(sameRoute(identity, route), true, "a ProxyIdentity (with username) is a ProxyRoute by structure");
});

test("proxyPasswordProblem flags control characters and over-long passwords only", () => {
  assert.equal(proxyPasswordProblem("a\u0085b"), true, "C1 control");
  assert.equal(proxyPasswordProblem("a\u0007b"), true, "C0 control");
  assert.equal(proxyPasswordProblem("a\u007fb"), true, "DEL");
  assert.equal(proxyPasswordProblem("x".repeat(1024)), false);
  assert.equal(proxyPasswordProblem("x".repeat(1025)), true);
  assert.equal(proxyPasswordProblem("p@ss:wörd"), false);
  assert.equal(proxyPasswordProblem(""), false, "emptiness is the caller's concern");
});
