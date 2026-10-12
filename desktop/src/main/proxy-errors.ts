// 站点主帧 did-fail-load 的 Chromium 网络错误号 → 站点码。只分出代理类失败；其余返回 null，由调用方回落 load_failed。
// 产出码用对象字面量（status-copy-coverage 的扫描器按字面量识别产出码），文案在 shared/copy.ts 三语。
// 号对照 Chromium net/base/net_error_list.h；名称即 did-fail-load 的 errorDescription，也是 net.request 的 net::ERR_* 后缀。
export type ProxyNetCode = "proxy_failed" | "proxy_auth_failed";

const PROXY_FAILED = { code: "proxy_failed" } as const;
const PROXY_AUTH_FAILED = { code: "proxy_auth_failed" } as const;

export const PROXY_NET_ERRORS: readonly (readonly [name: string, errno: number, result: { readonly code: ProxyNetCode }])[] = [
  ["ERR_TUNNEL_CONNECTION_FAILED", -111, PROXY_FAILED],
  // -115/-127 在 Electron 44 实测几乎不出现（HTTPS 隧道遇 407 报 -111）；熔断覆盖（view-manager.loadFailureCode）才是真实路径，这里仅作兜底。
  ["ERR_PROXY_AUTH_UNSUPPORTED", -115, PROXY_AUTH_FAILED],
  ["ERR_SOCKS_CONNECTION_FAILED", -120, PROXY_FAILED],
  ["ERR_SOCKS_CONNECTION_HOST_UNREACHABLE", -121, PROXY_FAILED],
  ["ERR_PROXY_AUTH_REQUESTED", -127, PROXY_AUTH_FAILED],
  ["ERR_PROXY_CONNECTION_FAILED", -130, PROXY_FAILED],
  ["ERR_MANDATORY_PROXY_CONFIGURATION_FAILED", -131, PROXY_FAILED],
  ["ERR_PROXY_CERTIFICATE_INVALID", -136, PROXY_FAILED]
];

const BY_ERRNO: ReadonlyMap<number, ProxyNetCode> = new Map(PROXY_NET_ERRORS.map(([, errno, result]) => [errno, result.code]));

export function classifyNetError(code: number): ProxyNetCode | null {
  return BY_ERRNO.get(code) ?? null;
}

export function isProxyNetCode(code: unknown): code is ProxyNetCode {
  return code === PROXY_FAILED.code || code === PROXY_AUTH_FAILED.code;
}
