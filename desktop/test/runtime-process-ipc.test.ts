import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

test("runtime diagnostics cross only the trusted shell bridge and handlers are removed", () => {
  const handlers = new Map<string, (event: unknown) => unknown>();
  const expected = [{ processType: "GPU", reason: "crashed", exitCode: 1 }];
  const trusted = {};
  const module = { exports: {} as { registerSiteHealthIpc(options: unknown): () => void } };
  runInNewContext(transformSync(readSource("src/main/site-health-ipc.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, require(name: string) {
      if (name === "electron") return { ipcMain: { handle: (key: string, fn: any) => handlers.set(key, fn), removeHandler: (key: string) => handlers.delete(key) } };
      if (name === "../shared/contracts") return { SITE_KEYS: ["kimi"] };
      assert.equal(name, "./runtime-process-diagnostics");
      return { runtimeProcessDiagnostics: { snapshot: () => expected } };
    }
  });
  const stop = module.exports.registerSiteHealthIpc({ manager: {}, trusted: (event: unknown) => event === trusted });
  const read = handlers.get("polyask:runtime-process-failures")!;
  assert.throws(() => read({}), /untrusted_sender/);
  assert.deepEqual(read(trusted), expected);
  stop();
  assert.equal(handlers.size, 0);
});
