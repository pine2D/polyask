// desktop/test/support/client-request-stub.ts
// Electron ClientRequest / IncomingMessage 的最小桩，供 net-request-fetch 及其上层（DriveClient、OAuth、probe）测试复用。
// 故意不以 .test.ts 命名：夹具不得从 *.test.ts import。
import { EventEmitter } from "node:events";

import type { AuthInfo, net } from "electron";

export type StubHeaders = Record<string, string | string[]>;

export class StubIncoming extends EventEmitter {
  constructor(readonly statusCode: number, readonly statusMessage: string, readonly headers: StubHeaders) {
    super();
  }
}

export interface StubRespondInit {
  readonly statusMessage?: string;
  readonly headers?: StubHeaders;
  readonly chunks?: readonly (string | Buffer)[];
  /** false = 只发响应头和已给的块，不发 end（模拟 body 读取阶段卡住）。 */
  readonly end?: boolean;
}

export class StubRequest extends EventEmitter {
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];
  aborted = 0;
  followed = 0;
  ended = false;

  constructor(readonly options: Record<string, unknown>) {
    super();
  }

  setHeader(name: string, value: string): void { this.headers.set(name.toLowerCase(), value); }
  write(chunk: string | Buffer): boolean {
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    return true;
  }
  end(chunk?: string | Buffer): this {
    if (chunk !== undefined) this.write(chunk);
    this.ended = true;
    this.emit("stub:end");
    return this;
  }
  abort(): void { this.aborted += 1; }
  followRedirect(): void { this.followed += 1; }

  bodyBytes(): Buffer { return Buffer.concat(this.chunks); }
  bodyText(): string { return this.bodyBytes().toString("utf8"); }

  respond(status: number, init: StubRespondInit = {}): StubIncoming {
    const incoming = new StubIncoming(status, init.statusMessage ?? "", init.headers ?? {});
    this.emit("response", incoming);
    for (const chunk of init.chunks ?? []) incoming.emit("data", typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    if (init.end !== false) incoming.emit("end");
    return incoming;
  }

  /** 仿 Electron manual 模式：redirect 事件里既没 followRedirect 也没 abort 时，以 "Redirect was cancelled" 失败。 */
  redirect(status: number, location: string): void {
    this.emit("redirect", status, String(this.options.method ?? "GET"), location, { location: [location] });
    if (this.followed === 0 && this.aborted === 0) this.emit("error", new Error("Redirect was cancelled"));
  }

  fail(message: string): void { this.emit("error", new Error(message)); }

  login(authInfo: AuthInfo, callback: (username?: string, password?: string) => void): void {
    this.emit("login", authInfo, callback);
  }
}

/** onEnd 在请求 end() 之后的下一个 setImmediate 调用，由用例决定回包、重定向、报错或不回（挂起）。 */
export function clientRequestStub(
  onEnd: (request: StubRequest, index: number) => void = () => undefined
): { readonly request: typeof net.request; readonly requests: StubRequest[] } {
  const requests: StubRequest[] = [];
  const request = (options: unknown): StubRequest => {
    const created = new StubRequest(typeof options === "string" ? { url: options } : { ...(options as Record<string, unknown>) });
    const index = requests.length;
    requests.push(created);
    created.once("stub:end", () => setImmediate(() => onEnd(created, index)));
    return created;
  };
  return { request: request as unknown as typeof net.request, requests };
}

export function proxyAuthInfo(isProxy = true): AuthInfo {
  return { isProxy, scheme: "basic", host: "proxy.example.test", port: 8080, realm: "polyask-test" };
}
