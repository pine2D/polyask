import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export interface TokenCrypto {
  readonly backend: () => string;
  readonly available: () => Promise<boolean>;
  readonly encrypt: (value: string) => Promise<Buffer>;
  readonly decrypt: (value: Buffer) => Promise<string>;
}

export type SecretReadResult = { kind: "none" } | { kind: "unreadable" } | { kind: "ok"; value: string };
export type SecretWriteResult = "saved" | "memory" | "aborted";
export interface SecretWriteGuard {
  readonly epoch: () => number;
  readonly expected: number;
}

const INSECURE_BACKENDS: readonly string[] = ["basic_text", "unknown", "unavailable"];

/**
 * 钥匙环时限：Linux 钥匙环锁定或 D-Bus 无响应时，isAsyncEncryptionAvailable / encryptStringAsync / decryptStringAsync
 * 都可能永不返回。读、写的钥匙环阶段与公开的 securePersistence() 共用这个时限；clear 只 unlink，不经过钥匙环。
 */
export const SECRET_KEYRING_TIMEOUT_MS = 10_000;
export const SECRET_WRITE_TIMEOUT = "secret_write_timeout";
const TIMED_OUT: unique symbol = Symbol("keyring_timed_out");

/** 同步的后端门控：basic_text / unknown / unavailable 都不算安全落盘。 */
export function secureBackend(crypto: TokenCrypto): boolean {
  return !INSECURE_BACKENDS.includes(crypto.backend());
}

export async function safeEncryptionAvailability(check: () => Promise<boolean>): Promise<boolean> {
  try { return await check(); }
  catch { return false; }
}

const stale = (guard: SecretWriteGuard | undefined): boolean =>
  guard !== undefined && guard.epoch() !== guard.expected;

/**
 * 通用加密文件存储（OAuth refresh token、代理密码共用）。
 * read / write / clear 排在同一条 promise 链上：clear 一定落在所有已发起的 write 之后，
 * 不会出现 unlink 抢在 rename 之前、随后旧 write 又把密文写回的情况。
 * 本类不持有内存副本；write 返回 "memory" 表示没有安全后端、未落盘，由调用方自己保管明文。
 */
export class SecretFileStore {
  private tail: Promise<void> = Promise.resolve();
  private pendingRead: Promise<SecretReadResult> | null = null;
  private readonly invalidCode: string;
  private readonly keyringTimeoutMs: number;

  constructor(
    private readonly path: string,
    readonly crypto: TokenCrypto,
    opts: { invalidCode?: string; keyringTimeoutMs?: number } = {}
  ) {
    this.invalidCode = opts.invalidCode ?? "invalid_secret";
    this.keyringTimeoutMs = opts.keyringTimeoutMs ?? SECRET_KEYRING_TIMEOUT_MS;
  }

  /** 不经过 promise 链，直接被 proxy-state、加密状态刷新调用；查询挂起时按「不能安全落盘」答复，不让调用方一直等。 */
  async securePersistence(): Promise<boolean> {
    return (await this.withinKeyringTimeout(this.secureNow())) === true;
  }

  /**
   * 合并读：排队中或进行中的 read 在其后没有 write / clear 入队、且尚未结束时，新的 read 直接复用同一个 promise。
   * 否则钥匙环挂起时每次调用方重试都会在链上多占一个时限，积压无界，后面的 write / clear 要等所有读排完。
   */
  read(): Promise<SecretReadResult> {
    if (this.pendingRead) return this.pendingRead;
    const run = this.serial(() => this.readNow());
    this.pendingRead = run;
    const release = (): void => { if (this.pendingRead === run) this.pendingRead = null; };
    run.then(release, release);
    return run;
  }

  write(value: string, guard?: SecretWriteGuard): Promise<SecretWriteResult> {
    if (typeof value !== "string" || !value) return Promise.reject(new Error(this.invalidCode));
    this.pendingRead = null; // 此后发起的 read 必须排在这次 write 之后
    return this.serial(() => this.writeNow(value, guard));
  }

  clear(): Promise<void> {
    this.pendingRead = null;
    return this.serial(() => this.clearNow());
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    // 失败只回给本次调用者，不能毒化后面排队的 read/write/clear。
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readNow(): Promise<SecretReadResult> {
    const result = await this.withinKeyringTimeout(this.readAndDecrypt());
    // 超时与 decrypt 失败同样只当本次读不到，绝不 unlink。迟到的结果被丢弃；链随之前进，
    // 排在后面的 write / clear（proxy-set 的 persistCredential、本机重置的 wipeSecrets）不会被一次挂起的读盘卡死。
    return result === TIMED_OUT ? { kind: "unreadable" } : result;
  }

  private async readAndDecrypt(): Promise<SecretReadResult> {
    if (!await this.secureNow()) return { kind: "none" };
    // 除 ENOENT 外的读文件失败（EACCES/EBUSY/EIO…）与 decrypt 失败（Linux 钥匙环未解锁、密文与当前用户密钥不匹配）
    // 一律记为 unreadable。两类在这里分不开——safeStorage 对锁住的钥匙环照样报 available——所以**只当本次读不到**，
    // 绝不 unlink：磁盘上可能是唯一的凭据，删了用户就得重新授权/重新输入且不知道为什么；真坏掉的文件会在下次
    // 成功写入时被整体覆盖，不需要在这里清。
    let encrypted: Buffer;
    try { encrypted = await readFile(this.path); }
    catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "none" } : { kind: "unreadable" };
    }
    try {
      const value = await this.crypto.decrypt(encrypted);
      return value ? { kind: "ok", value } : { kind: "unreadable" };
    } catch { return { kind: "unreadable" }; }
  }

  private async writeNow(value: string, guard: SecretWriteGuard | undefined): Promise<SecretWriteResult> {
    const encrypted = await this.withinKeyringTimeout(this.encryptIfSecure(value));
    // tmp 在时限内拿到密文之后才创建：超时一定没有 tmp、不动旧文件，迟到的密文也不会再 rename。
    // 以拒绝表达；明文由调用方保管（ProxyAuth 缓存 / TokenStore 内存副本），效果等同 "memory"，仅本次运行有效。
    if (encrypted === TIMED_OUT) throw new Error(SECRET_WRITE_TIMEOUT);
    if (encrypted === null) return "memory";
    // 写锁之外的第二道保险：encrypt 可能卡在钥匙环上很久，期间发生本机重置就放弃落盘。
    if (stale(guard)) return "aborted";
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(encrypted); await file.sync(); }
      finally { await file.close(); }
      if (stale(guard)) return "aborted";
      await rename(temporary, this.path);
    } finally { await unlink(temporary).catch(() => {}); }
    return "saved";
  }

  /** 不设时限的后端门控，只在已受时限约束的阶段里调用，避免嵌套计时器。 */
  private async secureNow(): Promise<boolean> {
    return secureBackend(this.crypto) && await this.crypto.available();
  }

  /** 没有安全后端返回 null（→ "memory"）；否则交给钥匙环加密。两步都可能卡在钥匙环上，一起受时限约束。 */
  private async encryptIfSecure(value: string): Promise<Buffer | null> {
    if (!await this.secureNow()) return null;
    return this.crypto.encrypt(value);
  }

  /**
   * 钥匙环阶段的时限：到点返回 TIMED_OUT，由调用方决定含义（write 拒绝、read 记 unreadable、securePersistence 答 false）。
   * work 自身的拒绝照常透传；超时之后 work 的结果或异常被丢弃，不会变成未处理的 rejection。
   */
  private withinKeyringTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<typeof TIMED_OUT>((done) => {
      timer = setTimeout(() => done(TIMED_OUT), this.keyringTimeoutMs);
    });
    work.catch(() => undefined);
    return Promise.race([work, expired]).finally(() => clearTimeout(timer));
  }

  private async clearNow(): Promise<void> {
    try { await unlink(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
