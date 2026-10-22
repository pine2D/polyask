import { net, type AuthInfo, type ClientRequest, type IncomingMessage, type Session } from "electron";

/**
 * Drive / OAuth 用的 fetch 适配器：基于 `net.request`，走所给 session 的代理设置（含系统代理），
 * 并接住请求级 `login`（`session.fetch` 不处理 login，Node 全局 fetch 不走 Chromium 代理）。
 * 契约见 docs/desktop.md §13。
 */
export type RequestLoginHandler = (
  request: object,
  authInfo: AuthInfo,
  callback: (username?: string, password?: string) => void
) => void;

export interface SessionFetchDeps {
  /** 测试注入 ClientRequest 桩；生产缺省为 Electron 的 `net.request`。 */
  readonly request?: typeof net.request;
  /** 仅在 `authInfo.isProxy === true` 时调用；缺省或非代理认证一律 `callback()` 取消。 */
  readonly onLogin?: RequestLoginHandler;
}

/** fetch 规范：最多跟随 20 次重定向，第 21 次即网络错误。 */
export const MAX_REDIRECTS = 20;
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
const REQUEST_BODY_HEADERS = ["content-encoding", "content-language", "content-location", "content-type"];

type Send = typeof net.request;
type BodyController = ReadableStreamDefaultController<Uint8Array>;
interface Hop { readonly url: URL; readonly method: string; readonly headers: Headers; readonly body: Buffer | null }
type Outcome = { readonly kind: "response"; readonly response: Response } | { readonly kind: "redirect"; readonly status: number; readonly location: string };

export function createSessionFetch(session: Session, deps: SessionFetchDeps = {}): typeof fetch {
  const send: Send = deps.request ?? ((options) => net.request(options));
  const sessionFetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const signal = init.signal ?? null;
    if (signal?.aborted) throw abortReason(signal);
    let hop = firstHop(input, init);
    for (let redirects = 0; ; redirects += 1) {
      const outcome = await exchange(send, session, hop, signal, deps.onLogin);
      if (outcome.kind === "response") return outcome.response;
      if (redirects >= MAX_REDIRECTS) throw networkError("net::ERR_TOO_MANY_REDIRECTS");
      hop = nextHop(hop, outcome.status, outcome.location);
    }
  };
  return sessionFetch as typeof fetch;
}

function firstHop(input: string | URL | Request, init: RequestInit): Hop {
  if (typeof input !== "string" && !(input instanceof URL)) throw new TypeError("unsupported_request_input");
  const url = new URL(String(input));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new TypeError("unsupported_request_url");
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const body = encodeBody(init.body, headers);
  if (body && (method === "GET" || method === "HEAD")) throw new TypeError("request_body_not_allowed");
  return { url, method, headers, body };
}

function encodeBody(body: RequestInit["body"], headers: Headers): Buffer | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") {
    if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8");
    return Buffer.from(body, "utf8");
  }
  if (body instanceof URLSearchParams) {
    if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    return Buffer.from(body.toString(), "utf8");
  }
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  throw new TypeError("unsupported_request_body");
}

/** 按 fetch 规范构造下一跳：301/302 的 POST 与 303 改 GET 并丢弃请求体；跨源去掉 Authorization。 */
function nextHop(hop: Hop, status: number, location: string): Hop {
  let url: URL;
  try { url = new URL(location, hop.url); } catch { throw networkError("net::ERR_INVALID_REDIRECT"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw networkError("net::ERR_UNSAFE_REDIRECT");
  const headers = new Headers(hop.headers);
  let method = hop.method;
  let body = hop.body;
  if (((status === 301 || status === 302) && method === "POST") || (status === 303 && method !== "GET" && method !== "HEAD")) {
    method = "GET";
    body = null;
    for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
  }
  // bearer token 绝不能跟着重定向去别的主机（与 undici 一致，见 drive-client.ts 的 session URI 注释）。
  if (url.origin !== hop.url.origin) headers.delete("authorization");
  return { url, method, headers, body };
}

/**
 * 发出一跳。redirect: "manual" 下不调用 followRedirect：在 redirect 事件里 abort 本跳，
 * 由 nextHop 重建下一跳，这样 Authorization 的去留完全由本模块决定。
 */
function exchange(send: Send, session: Session, hop: Hop, signal: AbortSignal | null, onLogin?: RequestLoginHandler): Promise<Outcome> {
  return new Promise<Outcome>((resolve, reject) => {
    if (signal?.aborted) { reject(abortReason(signal)); return; }
    let request: ClientRequest;
    try {
      request = send({ method: hop.method, url: hop.url.href, session, useSessionCookies: false, cache: "no-store", redirect: "manual" });
    } catch (error) { reject(networkError(errorMessage(error), error)); return; }
    let phase: "request" | "body" | "done" = "request";
    let body: BodyController | null = null;
    const finish = (): void => {
      phase = "done";
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown): void => {
      if (phase === "request") { finish(); reject(error); return; }
      if (phase !== "body") return;
      finish();
      try { body?.error(error); } catch { /* 流已结束 */ }
    };
    function onAbort(): void {
      if (phase === "done" || !signal) return;
      fail(abortReason(signal));
      request.abort();
    }
    request.on("response", (incoming: IncomingMessage) => {
      if (phase !== "request") return;
      const nullBody = NULL_BODY_STATUS.has(incoming.statusCode) || hop.method === "HEAD";
      const holder: { controller?: BodyController } = {};
      const stream = nullBody ? null : new ReadableStream<Uint8Array>({
        start(controller) { holder.controller = controller; },
        cancel() {
          if (phase !== 'body') return;
          finish(); // Late native data/end events must no longer touch this closed stream.
          request.abort();
        }
      });
      let response: Response;
      try {
        response = new Response(stream, { status: incoming.statusCode, statusText: reasonPhrase(incoming.statusMessage), headers: responseHeaders(incoming.headers) });
      } catch (error) {
        fail(networkError("net::ERR_INVALID_RESPONSE", error));
        request.abort();
        return;
      }
      if (!holder.controller) { finish(); resolve({ kind: "response", response }); return; }
      body = holder.controller;
      phase = "body";
      incoming.on("data", (chunk: Buffer) => { if (phase === "body") body?.enqueue(new Uint8Array(chunk)); });
      incoming.on("end", () => {
        if (phase !== "body") return;
        finish();
        body?.close();
      });
      incoming.on("aborted", () => fail(networkError("net::ERR_ABORTED")));
      incoming.on("error", (error: Error) => fail(networkError(error.message, error)));
      resolve({ kind: "response", response });
    });
    request.on("redirect", (status: number, _method: string, redirectUrl: string) => {
      if (phase !== "request") return;
      finish();
      request.abort();
      resolve({ kind: "redirect", status, location: redirectUrl });
    });
    request.on("login", (authInfo: AuthInfo, callback: (username?: string, password?: string) => void) => {
      if (phase === "done" || authInfo.isProxy !== true || !onLogin) { callback(); return; }
      onLogin(request, authInfo, callback);
    });
    request.on("error", (error: Error) => fail(networkError(error.message, error)));
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (const [name, value] of hop.headers) request.setHeader(name, value);
      if (hop.body) request.end(hop.body); else request.end();
    } catch (error) {
      fail(networkError(errorMessage(error), error));
      request.abort();
    }
  });
}

function responseHeaders(raw: Record<string, string | string[]>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return headers;
}

function reasonPhrase(value: string | undefined): string {
  return typeof value === "string" && /^[\t\x20-\x7e]*$/.test(value) ? value : "";
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : new DOMException("This operation was aborted", "AbortError");
}

/** Chromium 的 `net::ERR_*` 名原样留在 message 里，供上层按机器字面量分类（§5.2）。 */
function networkError(message: string, cause?: unknown): TypeError {
  return cause === undefined ? new TypeError(message) : new TypeError(message, { cause });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "net::ERR_FAILED";
}
