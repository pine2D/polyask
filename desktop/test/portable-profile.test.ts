import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  applyPortableImportIdentity,
  finalizePortableDataImport,
  hasImportableLegacyData,
  initializePortableData,
  isPortableDataInitialized,
  preparePortableBootstrap,
  resolveRuntimeProfile
} from "../src/main/portable-profile";

test("a packaged portable copy keeps its profile beside the application", () => {
  const root = join(tmpdir(), "PolyAsk Portable");
  const execPath = join(root, "App", process.platform === "win32" ? "polyask-desktop.exe" : "polyask-desktop");
  const profile = resolveRuntimeProfile({
    isPackaged: true,
    execPath,
    defaultUserDataPath: join(tmpdir(), "installed", "PolyAsk"),
    version: "0.20.0",
    markerExists: (path: string) => path === join(root, "portable.json")
  }) as { distribution: string; userDataPath: string; portableRoot: string; legacyUserDataPath: string };

  assert.equal(profile.distribution, "portable");
  assert.equal(profile.portableRoot, root);
  assert.equal(profile.userDataPath, join(root, "PolyAsk Data"));
  assert.equal(profile.legacyUserDataPath, join(tmpdir(), "installed", "PolyAsk"));
});

test("an installed or development copy keeps Electron's default profile", () => {
  const defaultUserDataPath = join(tmpdir(), "installed", "PolyAsk");
  for (const isPackaged of [false, true]) {
    const profile = resolveRuntimeProfile({
      isPackaged,
      execPath: join(tmpdir(), "PolyAsk", "polyask-desktop.exe"),
      defaultUserDataPath,
      version: "0.20.0",
      markerExists: () => false
    }) as { distribution: string; userDataPath: string; portableRoot?: string };
    assert.deepEqual(profile, {
      distribution: "installed",
      version: "0.20.0",
      userDataPath: defaultUserDataPath
    });
  }
});

test("first portable launch imports settings and site sessions without removing source data", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-profile-"));
  const source = join(root, "installed", "PolyAsk");
  const target = join(root, "portable", "PolyAsk Data");
  await mkdir(join(source, "Partitions", "polyask-sites"), { recursive: true });
  await writeFile(join(source, "polyask.sqlite"), "workspace");
  await writeFile(join(source, "Local State"), "encryption-key");
  await writeFile(join(source, "Partitions", "polyask-sites", "Cookies"), "site-logins");
  await writeFile(join(source, "lockfile"), "old-process-lock");

  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: dirname(target),
    userDataPath: target,
    legacyUserDataPath: source
  } as const;
  const result = await initializePortableData(profile, async () => true);

  assert.equal(result, "import_staged");
  await mkdir(join(target, "Crashpad"), { recursive: true });
  await writeFile(join(target, "Crashpad", "client_id"), "runtime metadata");
  await assert.rejects(readFile(join(target, "polyask.sqlite"), "utf8"), /ENOENT/);
  assert.equal(finalizePortableDataImport(profile), true);
  assert.equal(await readFile(join(target, "polyask.sqlite"), "utf8"), "workspace");
  assert.equal(await readFile(join(target, "Local State"), "utf8"), "encryption-key");
  assert.equal(await readFile(join(target, "Partitions", "polyask-sites", "Cookies"), "utf8"), "site-logins");
  await assert.rejects(readFile(join(target, "lockfile"), "utf8"), /ENOENT/);
  assert.equal(await readFile(join(source, "polyask.sqlite"), "utf8"), "workspace");

  let importedDeviceId = "";
  assert.equal(applyPortableImportIdentity(profile, (deviceId) => { importedDeviceId = deviceId; }), true);
  assert.match(importedDeviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(applyPortableImportIdentity(profile, () => assert.fail("identity reset repeated")), false);
});

test("portable initialization propagates marker I/O errors instead of treating them as missing", () => {
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: join(tmpdir(), "portable"),
    userDataPath: join(tmpdir(), "portable", "PolyAsk Data"),
    legacyUserDataPath: join(tmpdir(), "legacy")
  } as const;
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });

  assert.throws(() => isPortableDataInitialized(profile, () => { throw denied; }), (error) => error === denied);
  assert.throws(() => hasImportableLegacyData(profile, () => { throw denied; }), (error) => error === denied);
});

test("a staged import accepts Electron Local State created after its bootstrap marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-local-state-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "Local State"), "legacy-state");
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  } as const;

  assert.equal(await initializePortableData(profile, async () => true), "import_staged");
  await writeFile(join(target, "Local State"), "bootstrap-state");

  assert.equal(finalizePortableDataImport(profile), true);
  assert.equal(await readFile(join(target, "Local State"), "utf8"), "legacy-state");
});

test("an unrecognized portable data directory is never replaced by a staged import", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-conflict-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "polyask.sqlite"), "source");
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  } as const;

  assert.equal(await initializePortableData(profile, async () => true), "import_staged");
  await writeFile(join(target, "keep-me.txt"), "user data");
  assert.throws(() => finalizePortableDataImport(profile), /portable_data_unrecognized/);
  assert.equal(await readFile(join(target, "keep-me.txt"), "utf8"), "user data");
  assert.equal(await readFile(join(root, ".polyask-import-v1", "polyask.sqlite"), "utf8"), "source");
});

test("unknown files in PolyAsk Data stop initialization before the import prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-unknown-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(source, "polyask.sqlite"), "source");
  await writeFile(join(target, "keep-me.txt"), "user data");
  let prompts = 0;

  await assert.rejects(initializePortableData({
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  }, async () => { prompts += 1; return true; }), /portable_data_unrecognized/);

  assert.equal(prompts, 0);
  assert.equal(await readFile(join(target, "keep-me.txt"), "utf8"), "user data");
});

test("an interrupted identity reset retries with the same portable device id", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-identity-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "polyask.sqlite"), "workspace");
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  } as const;

  assert.equal(await initializePortableData(profile, async () => true), "import_staged");
  assert.equal(finalizePortableDataImport(profile), true);
  let firstId = "";
  assert.throws(() => applyPortableImportIdentity(profile, (deviceId) => {
    firstId = deviceId;
    throw new Error("database unavailable");
  }), /database unavailable/);
  let retriedId = "";
  assert.equal(applyPortableImportIdentity(profile, (deviceId) => { retriedId = deviceId; }), true);
  assert.equal(retriedId, firstId);
});

test("legacy detection ignores an empty directory and Electron lock metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-empty-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "lockfile"), "process-lock");
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  } as const;
  let prompts = 0;

  assert.equal(hasImportableLegacyData(profile), false);
  const result = await initializePortableData(profile, async () => {
    prompts += 1;
    return true;
  }, false);

  assert.equal(result, "fresh");
  assert.equal(prompts, 0);
});

test("legacy detection recognizes PolyAsk settings and Chromium sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-legacy-"));
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: join(root, "PolyAsk Data"),
    legacyUserDataPath: join(root, "legacy")
  } as const;

  await mkdir(profile.legacyUserDataPath, { recursive: true });
  assert.equal(hasImportableLegacyData(profile), false);
  await writeFile(join(profile.legacyUserDataPath, "polyask.sqlite"), "settings");
  assert.equal(hasImportableLegacyData(profile), true);
});

test("an initialized portable profile is preserved without another import prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-existing-"));
  const target = join(root, "PolyAsk Data");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, ".polyask-data-v1"), "1\n");
  await writeFile(join(target, "polyask.sqlite"), "existing");
  let prompts = 0;

  const result = await initializePortableData({
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: join(root, "legacy")
  }, async () => { prompts += 1; return true; }) as string;

  assert.equal(result, "ready");
  assert.equal(prompts, 0);
  assert.equal(await readFile(join(target, "polyask.sqlite"), "utf8"), "existing");
});

test("portable initialization is recognized only after its data marker exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-marker-"));
  const profile = {
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: join(root, "PolyAsk Data"),
    legacyUserDataPath: join(root, "legacy")
  } as const;

  assert.equal(isPortableDataInitialized(profile), false);
  await mkdir(profile.userDataPath, { recursive: true });
  await writeFile(join(profile.userDataPath, ".polyask-data-v1"), "1\n");
  assert.equal(isPortableDataInitialized(profile), true);
});

test("starting fresh removes an incomplete import without changing the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-portable-fresh-"));
  const source = join(root, "legacy");
  const target = join(root, "PolyAsk Data");
  const partial = join(root, ".polyask-import-v1", "Cookies");
  await mkdir(source, { recursive: true });
  await mkdir(dirname(partial), { recursive: true });
  await writeFile(join(source, "polyask.sqlite"), "source");
  await writeFile(partial, "partial");

  const result = await initializePortableData({
    distribution: "portable",
    version: "0.20.0",
    portableRoot: root,
    userDataPath: target,
    legacyUserDataPath: source
  }, async () => false);

  assert.equal(result, "fresh");
  await assert.rejects(readFile(partial, "utf8"), /ENOENT/);
  assert.equal(await readFile(join(source, "polyask.sqlite"), "utf8"), "source");
});

test("packaged preview marker isolates Preview Data and never imports formal legacy data", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-preview-profile-"));
  const formalAppData = join(root, "Roaming", "PolyAsk");
  await mkdir(formalAppData, { recursive: true });
  await writeFile(join(formalAppData, "polyask.sqlite"), "formal-production-data");
  await writeFile(join(root, "portable.json"), JSON.stringify({
    format: 1,
    dataDirectory: "Preview Data",
    preview: true
  }, null, 2));

  const execPath = join(root, "App", process.platform === "win32" ? "polyask-desktop.exe" : "polyask-desktop");
  const profile = resolveRuntimeProfile({
    isPackaged: true,
    execPath,
    defaultUserDataPath: formalAppData,
    version: "1.34.0"
  });

  assert.equal(profile.distribution, "portable");
  assert.equal(profile.preview, true);
  assert.equal(profile.portableRoot, root);
  assert.equal(profile.userDataPath, join(root, "Preview Data"));
  assert.equal(profile.legacyUserDataPath, undefined);
  assert.equal(hasImportableLegacyData(profile), false);

  let prompts = 0;
  const initResult = await initializePortableData(profile, async () => {
    prompts += 1;
    return true;
  }, true);
  assert.equal(initResult, "fresh");
  assert.equal(prompts, 0);
  assert.equal(isPortableDataInitialized(profile), true);
  await assert.rejects(readFile(join(profile.userDataPath, "polyask.sqlite"), "utf8"), /ENOENT/);
  assert.equal(await readFile(join(formalAppData, "polyask.sqlite"), "utf8"), "formal-production-data");
});

test("envPreview activates preview mode only in unpackaged development runs", () => {
  const defaultUserDataPath = join(tmpdir(), "dev", "PolyAsk");
  const devPreview = resolveRuntimeProfile({
    isPackaged: false,
    execPath: join(tmpdir(), "electron"),
    defaultUserDataPath,
    version: "1.34.0",
    envPreview: true
  });
  assert.deepEqual(devPreview, {
    distribution: "installed",
    version: "1.34.0",
    userDataPath: join(tmpdir(), "dev", "PolyAsk-Preview"),
    preview: true
  });

  const packagedFormal = resolveRuntimeProfile({
    isPackaged: true,
    execPath: join(tmpdir(), "PolyAsk", "App", "polyask-desktop.exe"),
    defaultUserDataPath,
    version: "1.34.0",
    envPreview: true,
    readMarker: () => null
  });
  assert.deepEqual(packagedFormal, {
    distribution: "installed",
    version: "1.34.0",
    userDataPath: defaultUserDataPath
  });
});

test("portable marker parser rejects path traversal, invalid formats, and preview sharing PolyAsk Data", () => {
  const base = {
    isPackaged: true,
    execPath: join(tmpdir(), "PolyAsk-Preview", "App", "polyask-desktop.exe"),
    defaultUserDataPath: join(tmpdir(), "Roaming", "PolyAsk"),
    version: "1.34.0"
  };
  for (const invalid of [
    "{not-json",
    JSON.stringify({ format: 2, dataDirectory: "Preview Data", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "../escape", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "Preview Data.", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "Preview Data ", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "PolyAsk Data", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "polyask data", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "POLYASK DATA", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "App", preview: false }),
    JSON.stringify({ format: 1, dataDirectory: "app", preview: true }),
    JSON.stringify({ format: 1, dataDirectory: "Preview Data", preview: "yes" })
  ]) {
    assert.throws(() => resolveRuntimeProfile({ ...base, readMarker: () => invalid }), /portable_data_unrecognized/);
  }
});

test("Windows Chromium startup caches created after pre-setPath bootstrap never trip unrecognized-data errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-win-chromium-bootstrap-"));

  // 1. Packaged Preview first launch: preparePortableBootstrap runs before setPath, then Chromium writes caches
  const previewProfile = {
    distribution: "portable",
    version: "1.34.0",
    preview: true,
    portableRoot: root,
    userDataPath: join(root, "Preview Data")
  } as const;
  const previewNonce = preparePortableBootstrap(previewProfile);
  assert.ok(previewNonce);
  await mkdir(join(previewProfile.userDataPath, "GPUPersistentCache", "DawnGraphiteCache"), { recursive: true });
  await mkdir(join(previewProfile.userDataPath, "GrShaderCache"), { recursive: true });
  await mkdir(join(previewProfile.userDataPath, "ShaderCache"), { recursive: true });
  await writeFile(join(previewProfile.userDataPath, "Local State"), "{\"os_crypt\":{}}");
  assert.equal(await initializePortableData(previewProfile, async () => false), "fresh");
  assert.equal(isPortableDataInitialized(previewProfile), true);

  // 2. Formal Portable first launch + staged import with Windows Chromium GPU caches
  const legacyDir = join(root, "Roaming", "PolyAsk");
  const portableDir = join(root, "PolyAsk Data");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "polyask.sqlite"), "formal-db");
  const portableProfile = {
    distribution: "portable",
    version: "1.34.0",
    portableRoot: root,
    userDataPath: portableDir,
    legacyUserDataPath: legacyDir
  } as const;
  const portableNonce = preparePortableBootstrap(portableProfile);
  assert.ok(portableNonce);
  await mkdir(join(portableDir, "GPUPersistentCache"), { recursive: true });
  await mkdir(join(portableDir, "GrShaderCache"), { recursive: true });
  await mkdir(join(portableDir, "ShaderCache"), { recursive: true });
  await writeFile(join(portableDir, "Local State"), "bootstrap-local-state");
  assert.equal(await initializePortableData(portableProfile, async () => true), "import_staged");
  assert.equal(finalizePortableDataImport(portableProfile), true);
  assert.equal(await readFile(join(portableDir, "polyask.sqlite"), "utf8"), "formal-db");
});

test("uninitialized Preview Data with only Chromium startup files recovers cleanly while user files still block", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-preview-recovery-"));
  const previewData = join(root, "Preview Data");
  await mkdir(join(previewData, "GPUPersistentCache", "DawnGraphiteCache"), { recursive: true });
  await mkdir(join(previewData, "GrShaderCache"), { recursive: true });
  await mkdir(join(previewData, "ShaderCache"), { recursive: true });
  await writeFile(join(previewData, "Local State"), "{}");

  const previewProfile = {
    distribution: "portable",
    version: "1.34.0",
    preview: true,
    portableRoot: root,
    userDataPath: previewData
  } as const;

  assert.ok(preparePortableBootstrap(previewProfile));
  assert.equal(await initializePortableData(previewProfile, async () => false), "fresh");
  assert.equal(isPortableDataInitialized(previewProfile), true);

  // Unknown user file in uninitialized Preview Data or Formal Portable still fails closed before setPath
  const conflictDir = join(root, "Conflict Preview Data");
  await mkdir(conflictDir, { recursive: true });
  await writeFile(join(conflictDir, "notes.txt"), "important");
  assert.throws(() => preparePortableBootstrap({
    ...previewProfile,
    userDataPath: conflictDir
  }), /portable_data_unrecognized/);

  // Formal portable without bootstrap marker still rejects unmarked Local State before setPath
  const unmarkedFormal = join(root, "Unmarked PolyAsk Data");
  await mkdir(unmarkedFormal, { recursive: true });
  await writeFile(join(unmarkedFormal, "Local State"), "preexisting");
  assert.throws(() => preparePortableBootstrap({
    distribution: "portable",
    version: "1.34.0",
    portableRoot: root,
    userDataPath: unmarkedFormal,
    legacyUserDataPath: join(root, "legacy")
  }), /portable_data_unrecognized/);

  // Session/cookie directories (Network, Local Storage, Preferences) or mismatched file/dir types still fail closed
  const sessionPreview = join(root, "Session Preview Data");
  await mkdir(join(sessionPreview, "Network"), { recursive: true });
  await writeFile(join(sessionPreview, "Network", "Cookies"), "real-session");
  assert.throws(() => preparePortableBootstrap({ ...previewProfile, userDataPath: sessionPreview }), /portable_data_unrecognized/);

  const wrongTypePreview = join(root, "Wrong Type Preview Data");
  await mkdir(join(wrongTypePreview, "Local State"), { recursive: true });
  assert.throws(() => preparePortableBootstrap({ ...previewProfile, userDataPath: wrongTypePreview }), /portable_data_unrecognized/);

  const stagedSessionRoot = await mkdtemp(join(tmpdir(), "polyask-staged-session-"));
  const stagedLegacy = join(stagedSessionRoot, "legacy");
  const stagedTarget = join(stagedSessionRoot, "PolyAsk Data");
  await mkdir(stagedLegacy, { recursive: true });
  await writeFile(join(stagedLegacy, "polyask.sqlite"), "legacy-db");
  const stagedProfile = {
    distribution: "portable",
    version: "1.34.0",
    portableRoot: stagedSessionRoot,
    userDataPath: stagedTarget,
    legacyUserDataPath: stagedLegacy
  } as const;
  assert.equal(await initializePortableData(stagedProfile, async () => true), "import_staged");
  await mkdir(join(stagedTarget, "Network"), { recursive: true });
  await writeFile(join(stagedTarget, "Network", "Cookies"), "do-not-delete");
  assert.throws(() => finalizePortableDataImport(stagedProfile), /portable_data_unrecognized/);
  assert.equal(await readFile(join(stagedTarget, "Network", "Cookies"), "utf8"), "do-not-delete");
});
