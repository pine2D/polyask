/**
 * Chromium net error names that mean the proxy, not the destination, failed: ERR_PROXY_*,
 * ERR_TUNNEL_*, ERR_SOCKS_* and ERR_MANDATORY_PROXY_*. The net.request adapter
 * (main/net-request-fetch.ts) carries them verbatim in Error.message. They are machine
 * literals, never user copy; callers turn a match into the `proxy_error` code.
 */
const PROXY_NET_ERROR = /^net::ERR_(PROXY|TUNNEL|SOCKS|MANDATORY_PROXY)/;

export function isProxyNetError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && PROXY_NET_ERROR.test(message);
}
