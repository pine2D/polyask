import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import config from "../forge.config";

test("Forge config leaves Windows portable packaging to the dedicated release script", () => {
  assert.equal(config.packagerConfig?.executableName, "polyask-desktop");
  assert.equal(config.packagerConfig?.icon, resolve(__dirname, "../resources/icon"));
  const extra = Array.isArray(config.packagerConfig?.extraResource)
    ? config.packagerConfig.extraResource
    : [];
  assert.ok(extra.includes(resolve(__dirname, "../resources/icon.ico")), "packages Windows multi-size icon");
  assert.ok(extra.includes(resolve(__dirname, "../resources/icon.png")), "packages Linux runtime icon");

  const makers = config.makers ?? [];
  const byName = new Map(makers.map((maker) => ["name" in maker ? maker.name : "", maker]));

  const squirrel = byName.get("@electron-forge/maker-squirrel");
  assert.deepEqual(squirrel?.platforms, ["win32"]);
  assert.equal(
    (squirrel && "config" in squirrel ? (squirrel.config as Record<string, unknown>).setupIcon : undefined),
    resolve(__dirname, "../resources/icon.ico")
  );
  assert.equal(
    (squirrel && "config" in squirrel ? (squirrel.config as Record<string, unknown>).iconUrl : undefined),
    "https://raw.githubusercontent.com/pine2D/polyask/main/desktop/resources/icon.ico"
  );

  const deb = byName.get("@electron-forge/maker-deb");
  assert.deepEqual(deb?.platforms, ["linux"]);
  assert.equal(
    ((deb && "config" in deb ? (deb.config as { options?: Record<string, unknown> }).options?.icon : undefined)),
    resolve(__dirname, "../resources/icon.png")
  );

  assert.deepEqual(byName.get("@electron-forge/maker-zip")?.platforms, ["darwin"]);
});

test("App icon assets match deterministic pixel generator and parse cleanly across ICO, ICNS, and PNG", async () => {
  const pngBytes = readFileSync(resolve(__dirname, "../resources/icon.png"));
  const icoBytes = readFileSync(resolve(__dirname, "../resources/icon.ico"));
  const icnsBytes = readFileSync(resolve(__dirname, "../resources/icon.icns"));

  const generatorUrl = pathToFileURL(resolve(__dirname, "../scripts/generate-icons.mjs")).href;
  const generator = await import(generatorUrl) as {
    buildIconAssets: () => { png: Buffer; ico: Buffer; icns: Buffer };
  };
  const expected = generator.buildIconAssets();
  assert.equal(Buffer.compare(pngBytes, expected.png), 0, "icon.png matches deterministic generator");
  assert.equal(Buffer.compare(icoBytes, expected.ico), 0, "icon.ico matches deterministic generator");
  assert.equal(Buffer.compare(icnsBytes, expected.icns), 0, "icon.icns matches deterministic generator");

  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(pngBytes.readUInt32BE(16), 512);
  assert.equal(pngBytes.readUInt32BE(20), 512);

  const packagerRequire = createRequire(resolve(__dirname, "../node_modules/@electron/packager/package.json"));
  const reseditCjs = packagerRequire("resedit/cjs") as {
    load: () => Promise<{
      Data: {
        IconFile: {
          from: (buf: Buffer) => { icons: ReadonlyArray<{ width: number; height: number; bitCount: number }> };
        };
      };
    }>;
  };
  const resedit = await reseditCjs.load();
  const parsedIco = resedit.Data.IconFile.from(icoBytes);
  assert.deepEqual(
    parsedIco.icons.map((entry) => [entry.width, entry.height]),
    [
      [16, 16],
      [24, 24],
      [32, 32],
      [48, 48],
      [64, 64],
      [128, 128],
      [0, 0]
    ]
  );

  assert.equal(icnsBytes.toString("ascii", 0, 4), "icns");
  assert.equal(icnsBytes.readUInt32BE(4), icnsBytes.length);
  const chunkTypes: string[] = [];
  let offset = 8;
  while (offset < icnsBytes.length) {
    const type = icnsBytes.toString("ascii", offset, offset + 4);
    const len = icnsBytes.readUInt32BE(offset + 4);
    assert.ok(len > 16, `icns chunk ${type} must carry PNG data`);
    assert.deepEqual([...icnsBytes.subarray(offset + 8, offset + 16)], [137, 80, 78, 71, 13, 10, 26, 10]);
    chunkTypes.push(type);
    offset += len;
  }
  assert.equal(offset, icnsBytes.length);
  assert.deepEqual(chunkTypes, ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]);
});
