import assert from "node:assert/strict";
import test from "node:test";

import { PROXY_NET_ERRORS, classifyNetError, isProxyNetCode } from "../src/main/proxy-errors";
import { getCopy } from "../src/shared/copy";
import { SITE_CODES } from "../src/shared/protocol";
import { describeStatus, visibleStatus } from "../src/shared/status-copy";

// spec §5.1 的归类表；号对照 Chromium net/base/net_error_list.h。
const EXPECTED: Record<string, readonly [number, string]> = {
  ERR_TUNNEL_CONNECTION_FAILED: [-111, "proxy_failed"],
  ERR_PROXY_AUTH_UNSUPPORTED: [-115, "proxy_auth_failed"],
  ERR_SOCKS_CONNECTION_FAILED: [-120, "proxy_failed"],
  ERR_SOCKS_CONNECTION_HOST_UNREACHABLE: [-121, "proxy_failed"],
  ERR_PROXY_AUTH_REQUESTED: [-127, "proxy_auth_failed"],
  ERR_PROXY_CONNECTION_FAILED: [-130, "proxy_failed"],
  ERR_MANDATORY_PROXY_CONFIGURATION_FAILED: [-131, "proxy_failed"],
  ERR_PROXY_CERTIFICATE_INVALID: [-136, "proxy_failed"]
};

test("the proxy error table is exactly the spec's Chromium names and numbers", () => {
  const table = Object.fromEntries(PROXY_NET_ERRORS.map(([name, errno, result]) => [name, [errno, result.code]]));
  assert.deepEqual(table, EXPECTED);
  const numbers = PROXY_NET_ERRORS.map(([, errno]) => errno);
  assert.equal(new Set(numbers).size, numbers.length, "one classification per Chromium error number");
});

test("classifyNetError maps every proxy error and leaves everything else to the load_failed fallback", () => {
  for (const [name, [errno, code]] of Object.entries(EXPECTED)) assert.equal(classifyNetError(errno), code, name);
  // ERR_ABORTED、断网、DNS、直连拒绝、超时、证书、网络切换：都不是代理问题，调用方回落 load_failed。
  for (const errno of [0, -2, -3, -21, -100, -102, -105, -106, -118, -200, -310, -324, 111, 130, Number.NaN]) {
    assert.equal(classifyNetError(errno), null, String(errno));
  }
});

test("isProxyNetCode accepts only the two proxy site codes", () => {
  assert.equal(isProxyNetCode("proxy_failed"), true);
  assert.equal(isProxyNetCode("proxy_auth_failed"), true);
  for (const value of ["load_failed", "proxy_error", "proxy_apply_failed", "", undefined, null, -130, { code: "proxy_failed" }]) {
    assert.equal(isProxyNetCode(value), false, String(value));
  }
});

test("proxy site codes are registered status codes with copy in all three locales", () => {
  assert.equal(SITE_CODES.includes("proxy_failed"), true);
  assert.equal(SITE_CODES.includes("proxy_auth_failed"), true);
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const copy = getCopy(locale);
    assert.equal(describeStatus(copy, { site: "claude", phase: "failed", code: "proxy_failed" }), copy.proxyFailed, locale);
    assert.equal(describeStatus(copy, { site: "claude", phase: "failed", code: "proxy_auth_failed" }), copy.proxyAuthFailed, locale);
    assert.equal(visibleStatus(copy, { site: "claude", phase: "failed", code: "proxy_failed" }), copy.proxyFailed, locale);
    assert.notEqual(copy.proxyFailed, copy.loadFailed, `${locale}: the user must be pointed at the proxy, not the site`);
    assert.notEqual(copy.proxyAuthFailed, copy.proxyFailed, locale);
  }
  assert.equal(getCopy("zh-CN").proxyFailed, "代理连接失败，请检查代理设置");
  assert.equal(getCopy("zh-CN").proxyAuthFailed, "代理认证失败，请检查代理用户名和密码");
});
