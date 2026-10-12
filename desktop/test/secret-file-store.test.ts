import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SecretFileStore, secureBackend, type TokenCrypto } from "../src/main/secret-file-store";
import { TokenStore } from "../src/main/token-store";

function cipher(overrides: Partial<TokenCrypto> = {}): TokenCrypto {
  return {
    backend: () => "dpapi",
    available: async () => true,
    encrypt: async (value) => Buffer.from(`cipher:${value}`),
    decrypt: async (value) => value.toString().slice(7),
    ...overrides
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function withDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "polyask-secret-"));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

const tick = (): Promise<void> => new Promise((done) => setImmediate(done));

test("tagged reads distinguish none, ok and unreadable without deleting the file", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    const store = new SecretFileStore(path, cipher());
    assert.deepEqual(await store.read(), { kind: "none" }, "ENOENT 记为 none");
    assert.equal(await store.write("pw-1"), "saved");
    assert.deepEqual(await store.read(), { kind: "ok", value: "pw-1" });

    const broken = new SecretFileStore(path, cipher({ decrypt: async () => { throw new Error("keyring locked"); } }));
    assert.deepEqual(await broken.read(), { kind: "unreadable" }, "decrypt 失败记为 unreadable");
    assert.equal(await readFile(path, "utf8"), "cipher:pw-1", "读失败绝不 unlink");

    const empty = new SecretFileStore(path, cipher({ decrypt: async () => "" }));
    assert.deepEqual(await empty.read(), { kind: "unreadable" }, "解出空串不算有效凭据");
  });
});

test("a read error other than ENOENT is unreadable, not none", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await mkdir(path);
    assert.deepEqual(await new SecretFileStore(path, cipher()).read(), { kind: "unreadable" });
  });
});

test("an identity-bound JSON payload round-trips verbatim through the opaque store", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    const payload = JSON.stringify({ version: 1, scheme: "http", host: "proxy.example", port: 8080, username: "u", password: "p" });
    const store = new SecretFileStore(path, cipher());
    assert.equal(await store.write(payload), "saved");
    const again = await new SecretFileStore(path, store.crypto).read();
    assert.deepEqual(again, { kind: "ok", value: payload }, "身份字段原样保存，匹配由 proxy-auth 负责");
  });
});

test("saved secrets are written atomically with mode 0600 and no temporary leftovers", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "nested", "proxy-secret.bin");
    const store = new SecretFileStore(path, cipher());
    assert.equal(await store.write("old"), "saved");
    assert.equal(await store.write("new"), "saved");
    assert.equal(await readFile(path, "utf8"), "cipher:new");
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(directory, "nested")), ["proxy-secret.bin"]);
  });
});

test("insecure backends degrade to memory without encrypting or touching disk", async () => {
  for (const backend of ["basic_text", "unknown", "unavailable"]) {
    await withDir(async (directory) => {
      const path = join(directory, "proxy-secret.bin");
      const store = new SecretFileStore(path, cipher({
        backend: () => backend,
        encrypt: async () => { throw new Error("must_not_encrypt"); },
        decrypt: async () => { throw new Error("must_not_decrypt"); }
      }));
      assert.equal(secureBackend(store.crypto), false, backend);
      assert.equal(await store.securePersistence(), false, backend);
      assert.equal(await store.write("session-only"), "memory", backend);
      assert.deepEqual(await readdir(directory), [], backend);
      assert.deepEqual(await store.read(), { kind: "none" }, backend);
    });
  }
  await withDir(async (directory) => {
    const store = new SecretFileStore(join(directory, "proxy-secret.bin"), cipher({ available: async () => false }));
    assert.equal(secureBackend(store.crypto), true);
    assert.equal(await store.securePersistence(), false, "后端安全但 safeStorage 不可用同样只留内存");
    assert.equal(await store.write("session-only"), "memory");
    assert.deepEqual(await readdir(directory), []);
  });
});

test("empty values are rejected with the parameterized code before any work", async () => {
  let encrypted = 0;
  const crypto = cipher({ encrypt: async (value) => { encrypted += 1; return Buffer.from(value); } });
  await assert.rejects(new SecretFileStore("/unused/secret", crypto).write(""), { message: "invalid_secret" });
  await assert.rejects(
    new SecretFileStore("/unused/secret", crypto, { invalidCode: "proxy_invalid" }).write(""),
    { message: "proxy_invalid" }
  );
  assert.equal(encrypted, 0);
});

test("clear queued during an in-flight write runs after the rename and leaves no file", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    const started = deferred(), release = deferred();
    const store = new SecretFileStore(path, cipher({
      encrypt: async (value) => { started.resolve(); await release.promise; return Buffer.from(`cipher:${value}`); }
    }));
    const writing = store.write("secret");
    await started.promise;
    let cleared = false;
    const clearing = store.clear().then(() => { cleared = true; });
    await tick();
    assert.equal(cleared, false, "clear 必须排在进行中的 write 之后");
    release.resolve();
    assert.equal(await writing, "saved");
    await clearing;
    assert.equal(cleared, true);
    assert.deepEqual(await readdir(directory), []);
    assert.deepEqual(await store.read(), { kind: "none" });
  });
});

test("a read issued during a write observes the written value", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    const release = deferred();
    const store = new SecretFileStore(path, cipher({
      encrypt: async (value) => { await release.promise; return Buffer.from(`cipher:${value}`); }
    }));
    const writing = store.write("fresh");
    const reading = store.read();
    release.resolve();
    assert.equal(await writing, "saved");
    assert.deepEqual(await reading, { kind: "ok", value: "fresh" });
  });
});

test("an epoch change during encrypt aborts the write and keeps the previous file", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    let epoch = 0;
    const started = deferred(), release = deferred();
    const store = new SecretFileStore(path, cipher({
      encrypt: async (value) => { started.resolve(); await release.promise; return Buffer.from(`cipher:${value}`); }
    }));
    const writing = store.write("new", { epoch: () => epoch, expected: 0 });
    await started.promise;
    epoch = 1; // 本机重置在 encrypt 卡住期间发生
    release.resolve();
    assert.equal(await writing, "aborted");
    assert.equal(await readFile(path, "utf8"), "cipher:old");
    assert.deepEqual(await readdir(directory), ["proxy-secret.bin"]);
  });
});

test("an epoch change after the temporary file is written aborts before rename and deletes the temporary file", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    let checks = 0;
    const guard = { epoch: () => { checks += 1; return checks >= 2 ? 1 : 0; }, expected: 0 };
    const store = new SecretFileStore(path, cipher());
    assert.equal(await store.write("new", guard), "aborted");
    assert.equal(checks, 2, "encrypt 之后与 rename 之前各核对一次");
    assert.deepEqual(await readdir(directory), [], "tmp 已删除，目标文件未生成");
  });
});

test("a failed write rejects only its own caller and does not poison the queue", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await mkdir(path);
    await writeFile(join(path, "keep"), "original data");
    const store = new SecretFileStore(path, cipher());
    await assert.rejects(store.write("secret"));
    assert.deepEqual(await readdir(directory), ["proxy-secret.bin"], "失败只删自己的 tmp");
    assert.equal(await readFile(join(path, "keep"), "utf8"), "original data");
    assert.deepEqual(await store.read(), { kind: "unreadable" }, "队列继续执行后续操作");
  });
});

test("TokenStore wrapper keeps its empty-token code and inherits the serialized clear", async () => {
  await withDir(async (directory) => {
    const path = join(directory, "oauth-token.bin");
    const release = deferred();
    const tokens = new TokenStore(path, cipher({
      encrypt: async (value) => { await release.promise; return Buffer.from(`cipher:${value}`); }
    }));
    await assert.rejects(tokens.save(""), { message: "invalid_refresh_token" });
    assert.equal(await tokens.load(), null, "空值不进内存副本");
    const saving = tokens.save("refresh");
    const clearing = tokens.clear();
    release.resolve();
    assert.equal(await saving, true);
    await clearing;
    assert.deepEqual(await readdir(directory), [], "clear 落在 rename 之后，令牌文件不复活");
    assert.equal(await tokens.load(), null);
  });
});

test("an encrypt stuck on the keyring times out, keeps the old file and lets queued read and clear run", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    const late = deferred();
    const store = new SecretFileStore(path, cipher({
      encrypt: async (value) => {
        if (value === "stuck") await late.promise; // 钥匙环锁定：encryptStringAsync 不返回
        return Buffer.from(`cipher:${value}`);
      }
    }), { keyringTimeoutMs: 20 });
    const writing = store.write("stuck");
    const reading = store.read();
    const clearing = store.clear();
    await assert.rejects(writing, { message: "secret_write_timeout" });
    assert.deepEqual(await reading, { kind: "ok", value: "old" }, "超时不动旧文件；排在后面的 read 照常执行");
    await clearing;
    assert.deepEqual(await readdir(directory), [], "排在后面的 clear 照常执行，且没有 tmp 残留");
    late.resolve(); // 钥匙环迟到地返回了密文
    await tick();
    await tick();
    assert.deepEqual(await readdir(directory), [], "迟到的密文被丢弃：不建 tmp、不 rename、文件不复活");
    assert.equal(await store.write("next"), "saved", "超时之后的写入正常落盘");
    assert.equal(await readFile(path, "utf8"), "cipher:next");
  });
});

test("a keyring availability check that never answers times out before any encryption or disk work", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    let encrypted = 0;
    const store = new SecretFileStore(join(directory, "proxy-secret.bin"), cipher({
      available: () => new Promise<boolean>(() => {}),
      encrypt: async (value) => { encrypted += 1; return Buffer.from(value); }
    }), { keyringTimeoutMs: 20 });
    await assert.rejects(store.write("pw"), { message: "secret_write_timeout" });
    assert.equal(encrypted, 0);
    assert.deepEqual(await readdir(directory), []);
  });
});

// 读盘挂起：设置卡的惰性读盘或首个 407 卡在 decryptStringAsync 上，随后的保存（write/clear）与本机重置（clear）都排在它后面。
test("a decrypt stuck on the keyring reads as unreadable within the limit and lets queued write and clear finish", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    const late = deferred();
    let stuck = true;
    const store = new SecretFileStore(path, cipher({
      decrypt: async (value) => {
        if (stuck) await late.promise; // 钥匙环锁定：decryptStringAsync 不返回
        return value.toString().slice(7);
      }
    }), { keyringTimeoutMs: 20 });

    assert.deepEqual(await store.read(), { kind: "unreadable" }, "超时只当本次读不到");
    assert.equal(await readFile(path, "utf8"), "cipher:old", "读盘超时绝不 unlink");

    const reading = store.read();
    const writing = store.write("new"); // proxy-set 的 persistCredential
    const clearing = store.clear(); // 本机重置的 wipeSecrets
    assert.deepEqual(await reading, { kind: "unreadable" });
    assert.equal(await writing, "saved", "排在挂起 read 后面的 write 在时限后照常落盘");
    await clearing;
    assert.deepEqual(await readdir(directory), [], "排在后面的 clear 照常执行，最终没有密码文件");

    late.resolve(); // 两次挂起的 decrypt 迟到返回
    await tick();
    await tick();
    assert.deepEqual(await readdir(directory), [], "迟到的解密结果被丢弃，没有任何副作用");
    stuck = false;
    assert.equal(await store.write("next"), "saved");
    assert.deepEqual(await store.read(), { kind: "ok", value: "next" }, "钥匙环恢复后读写都正常");
  });
});

test("an availability check that never answers also bounds read and securePersistence, while clear skips the keyring", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    let decrypted = 0;
    const store = new SecretFileStore(path, cipher({
      available: () => new Promise<boolean>(() => {}),
      decrypt: async (value) => { decrypted += 1; return value.toString().slice(7); }
    }), { keyringTimeoutMs: 20 });
    assert.equal(await store.securePersistence(), false, "可用性查不到就按不能安全落盘答复");
    assert.deepEqual(await store.read(), { kind: "unreadable" }, "不是 none：文件还在，只是这次读不到");
    assert.equal(decrypted, 0);
    assert.equal(await readFile(path, "utf8"), "cipher:old");
    await store.clear();
    assert.deepEqual(await readdir(directory), [], "clear 不经过钥匙环");
  });
});

test("the default keyring timeout is ten seconds", { timeout: 2000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const store = new SecretFileStore("/unused/proxy-secret.bin", cipher({ encrypt: () => new Promise<Buffer>(() => {}) }));
  let settled = "pending";
  store.write("stuck").then(() => { settled = "resolved"; }, (error: Error) => { settled = error.message; });
  await tick(); // setImmediate 未被模拟：冲掉微任务，让 write 走到计时点
  t.mock.timers.tick(9_999);
  await tick();
  assert.equal(settled, "pending", "10s 之前不放弃");
  t.mock.timers.tick(1);
  await tick();
  assert.equal(settled, "secret_write_timeout");
});

test("reads are coalesced so a hung keyring cannot build a backlog in front of a later write", { timeout: 5000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    const late = deferred(), started = deferred();
    let decrypts = 0;
    const store = new SecretFileStore(path, cipher({
      decrypt: async (value) => { decrypts += 1; started.resolve(); await late.promise; return value.toString().slice(7); }
    }), { keyringTimeoutMs: 20 });
    // 同一个同步段内连发：不依赖墙钟，只数链上真正开始过几次钥匙环读取。
    const first = store.read();
    const reads = [first];
    for (let i = 0; i < 12; i += 1) reads.push(store.read());
    assert.ok(reads.every((read) => read === first), "back-to-back reads share one promise");
    assert.equal(await store.write("new"), "saved");
    // 计时器在 readFile 之前就启动，负载下读取可能先超时、decrypt 才开始：等它进入后再让出几轮，多排的读取链节也会进来。
    await started.promise;
    await tick(); await tick(); await tick();
    assert.equal(decrypts, 1, "write 之前链上只开始过一次挂起的读取，没有积压");
    assert.deepEqual(await Promise.all(reads), reads.map(() => ({ kind: "unreadable" })));
    late.resolve();
  });
});

test("a read issued after a queued write is a new chain link and sees the written value", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    const release = deferred();
    const store = new SecretFileStore(path, cipher({
      encrypt: async (value) => { await release.promise; return Buffer.from(`cipher:${value}`); }
    }));
    const before = store.read();
    const writing = store.write("fresh");
    const after = store.read();
    assert.notEqual(after, before);
    release.resolve();
    assert.deepEqual(await before, { kind: "none" });
    assert.equal(await writing, "saved");
    assert.deepEqual(await after, { kind: "ok", value: "fresh" });
    const settled = store.read();
    await settled;
    assert.notEqual(store.read(), settled, "a settled read is not reused");
  });
});

test("a read issued after a queued clear is a new chain link", { timeout: 2000 }, async () => {
  await withDir(async (directory) => {
    const path = join(directory, "proxy-secret.bin");
    await new SecretFileStore(path, cipher()).write("old");
    const store = new SecretFileStore(path, cipher());
    const before = store.read();
    const clearing = store.clear();
    const after = store.read();
    assert.notEqual(after, before);
    assert.deepEqual(await before, { kind: "ok", value: "old" });
    await clearing;
    assert.deepEqual(await after, { kind: "none" }, "clear 之后入队的 read 看到清除结果");
  });
});
