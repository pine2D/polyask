import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { readSource } from "./fixtures";

test("a cancelled application quit leaves repositories usable until final shutdown", () => {
  const database = new DatabaseSync(":memory:");
  const app = new EventEmitter();
  const source = readSource("src/main/index.ts");
  const registration = source.match(/app\.on\("(?:before-quit|will-quit)", \(\) => \{\s*desktopDatabase\?\.close\(\);\s*desktopDatabase = null;\s*\}\);/);
  assert.ok(registration, "must execute the production database shutdown registration");
  const context = { app, desktopDatabase: database as DatabaseSync | null };
  runInNewContext(registration[0], context);
  try {
    // Electron emits before-quit before a dirty renderer may veto beforeunload.
    app.emit("before-quit");
    assert.equal(database.prepare("SELECT 1 AS value").get()?.value, 1);
    assert.equal(context.desktopDatabase === database, true);
    app.emit("will-quit");
    assert.equal(context.desktopDatabase, null);
    assert.throws(() => database.prepare("SELECT 1"), /database is not open/);
  } finally { if (context.desktopDatabase) database.close(); }
});
