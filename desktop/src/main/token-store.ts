import { SecretFileStore, secureBackend, type TokenCrypto } from "./secret-file-store";

export { safeEncryptionAvailability } from "./secret-file-store";
export type { TokenCrypto } from "./secret-file-store";

/**
 * OAuth refresh token 存储：SecretFileStore 的薄包装。
 * 对外 API 与行为保持原样——内存优先、读不到一律 null、basic_text 只留内存、save 返回是否真正落盘。
 */
export class TokenStore {
  private memoryToken: string | null = null;
  private readonly file: SecretFileStore;

  constructor(path: string, readonly crypto: TokenCrypto) {
    this.file = new SecretFileStore(path, crypto, { invalidCode: "invalid_refresh_token", clearOnMemory: true });
  }

  securePersistence(): boolean {
    return secureBackend(this.crypto);
  }

  async save(refreshToken: string): Promise<boolean> {
    // 空值由 SecretFileStore 立即以 invalid_refresh_token 拒绝，且不改内存副本。
    const written = this.file.write(refreshToken);
    if (refreshToken) this.memoryToken = refreshToken;
    return await written === "saved";
  }

  async load(): Promise<string | null> {
    if (this.memoryToken) return this.memoryToken;
    const stored = await this.file.read();
    this.memoryToken = stored.kind === "ok" ? stored.value : null;
    return this.memoryToken;
  }

  async clear(): Promise<void> {
    this.memoryToken = null;
    await this.file.clear();
  }
}
