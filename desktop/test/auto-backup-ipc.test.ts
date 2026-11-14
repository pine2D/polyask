import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

test("auto-backup IPC enforces trusted sender, strict snapshot IDs, native Save dialog, and busy guard", async () => {
  const handlers = new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>();
  const exported = { exports: {} as { registerAutoBackupIpc: (options: unknown) => () => void } };
  let canceled = true;
  let defaultSavePath = "";
  let waitForSave: Promise<void> | null = null;

  const code = transformSync(readSource("src/main/auto-backup-ipc.ts"), { loader: "ts", format: "cjs" }).code;
  runInNewContext(code, {
    module: exported,
    exports: exported.exports,
    Error,
    Set,
    require: (name: string) => {
      if (name === "electron") {
        return {
          ipcMain: {
            handle: (key: string, fn: any) => handlers.set(key, fn),
            removeHandler: (key: string) => handlers.delete(key)
          },
          dialog: {
            showSaveDialog: async (_win: unknown, opts: { defaultPath: string }) => {
              defaultSavePath = opts.defaultPath;
              await waitForSave;
              return { canceled, filePath: "/chosen/auto-copy.polyask" };
            }
          }
        };
      }
      throw new Error(name);
    }
  });

  const validId = "auto-20261114-120000-a1b2c3d4";
  let textOnly = false;
  const exportedCopies: Array<{ id: string; dest: string }> = [];
  const autoBackup = {
    list: async () => [{ id: validId, filename: "polyask-auto-v1.34.0-to-v1.35.0-2026-11-14.polyask", textOnly }],
    preview: async (id: string) => ({ token: `tok-${id}`, filename: "auto.polyask", items: [] }),
    getSummary: async (id: string) => ({
      id,
      filename: "polyask-auto-v1.34.0-to-v1.35.0-2026-11-14.polyask",
      textOnly
    }),
    exportCopy: async (id: string, dest: string) => {
      exportedCopies.push({ id, dest });
    }
  };

  const dispose = exported.exports.registerAutoBackupIpc({
    window: {},
    autoBackup,
    trusted: (event: unknown) => event === true
  });

  assert.equal(handlers.size, 3);
  for (const fn of handlers.values()) {
    await assert.rejects(fn(false, validId), /untrusted_sender/);
  }

  for (const badId of [null, 123, "", "../escape", "auto-20261114-120000-GGGGGGGG", `${validId}/../x`]) {
    await assert.rejects(handlers.get("polyask:auto-backup-preview")!(true, badId), /invalid_request/);
    await assert.rejects(handlers.get("polyask:auto-backup-export")!(true, badId), /invalid_request/);
  }

  const listed = await handlers.get("polyask:auto-backup-list")!(true) as Array<{ id: string }>;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, validId);

  const preview = await handlers.get("polyask:auto-backup-preview")!(true, validId) as { token: string };
  assert.equal(preview.token, `tok-${validId}`);

  assert.equal(await handlers.get("polyask:auto-backup-export")!(true, validId), false);
  assert.equal(exportedCopies.length, 0);

  canceled = false;
  assert.equal(await handlers.get("polyask:auto-backup-export")!(true, validId), true);
  assert.equal(defaultSavePath, "polyask-auto-v1.34.0-to-v1.35.0-2026-11-14.polyask");
  assert.deepEqual(exportedCopies, [{ id: validId, dest: "/chosen/auto-copy.polyask" }]);

  textOnly = true;
  assert.equal(await handlers.get("polyask:auto-backup-export")!(true, validId), "text-only");

  let resolveSave!: () => void;
  waitForSave = new Promise<void>((resolve) => { resolveSave = resolve; });
  const pendingExport = handlers.get("polyask:auto-backup-export")!(true, validId);
  await assert.rejects(handlers.get("polyask:auto-backup-preview")!(true, validId), /backup_busy/);
  dispose();
  assert.equal(handlers.size, 0);
  resolveSave();
  assert.equal(await pendingExport, false);
  assert.equal(exportedCopies.length, 2, "closing window during Save dialog must not write another copy");
});
