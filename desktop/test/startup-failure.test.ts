import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

import { getCopy } from "../src/shared/copy";
import { readSource } from "./fixtures";

function loadStartupFailure({ dialogThrows = false } = {}) {
  const require = createRequire(resolve(__dirname, "../src/main/startup-failure.ts"));
  const shown: string[] = [];
  let quits = 0;
  const electron = {
    app: { getLocale: () => "en", quit: () => { quits += 1; } },
    dialog: {
      showErrorBox: (title: string, message: string) => {
        if (dialogThrows) throw new Error("no display");
        shown.push(`${title}|${message}`);
      }
    }
  };
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/startup-failure.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, console: { error() {} },
    require: (name: string) => name === "electron" ? electron : require(name)
  });
  return { show: module.exports.showStartupFailure as (error: unknown, distribution: string) => void, shown, quits: () => quits };
}

const copy = getCopy("en");

test("a portable storage error explains the portable folder and still quits", () => {
  const h = loadStartupFailure();
  h.show(Object.assign(new Error("open failed"), { code: "EACCES" }), "portable");
  assert.deepEqual(h.shown, [`${copy.portableStorageFailedTitle}|${copy.portableStorageFailedMessage}`]);
  assert.equal(h.quits(), 1);
});

test("the same errno on an installed build stays the generic startup failure", () => {
  const h = loadStartupFailure();
  h.show(Object.assign(new Error("open failed"), { code: "EACCES" }), "installed");
  assert.deepEqual(h.shown, [`${copy.startupFailedTitle}|${copy.startupFailedMessage}`]);
});

test("portable import and conflict codes keep their dedicated dialogs", () => {
  const h = loadStartupFailure();
  h.show(new Error("portable_import_failed"), "portable");
  h.show(new Error("portable_data_unrecognized"), "installed");
  assert.deepEqual(h.shown, [
    `${copy.portableImportFailedTitle}|${copy.portableImportFailedMessage}`,
    `${copy.portableDataConflictTitle}|${copy.portableDataConflictMessage}`
  ]);
  assert.equal(h.quits(), 2);
});

test("a dialog that cannot open never blocks the quit", () => {
  const h = loadStartupFailure({ dialogThrows: true });
  assert.throws(() => h.show(new Error("proxy_not_ready"), "installed"), /no display/);
  assert.equal(h.quits(), 1);
});
