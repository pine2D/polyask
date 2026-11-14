import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PREVIEW_MARKER,
  stagePreviewDirectory,
  validatePreviewTargetRoot
} from "./sync-windows-preview.mjs";

async function createFakePackage(root, exeContent = "preview-exe-v1") {
  const packageDir = join(root, "out", "PolyAsk-win32-x64");
  await mkdir(join(packageDir, "resources"), { recursive: true });
  await writeFile(join(packageDir, "polyask-desktop.exe"), exeContent, "utf8");
  await writeFile(join(packageDir, "resources", "app.asar"), "packaged-asar", "utf8");
  return packageDir;
}

test("stagePreviewDirectory writes isolated PolyAsk-Preview layout and preserves Preview Data across updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-win-preview-"));
  try {
    const packageV1 = await createFakePackage(root, "exe-v1");
    const targetRoot = join(root, "Local", "PolyAsk-Preview");
    let fuseChecks = 0;

    const first = await stagePreviewDirectory({
      packageDir: packageV1,
      targetRoot,
      forbiddenPaths: [join(root, "Roaming", "PolyAsk"), join(root, "Local", "PolyAsk")],
      verifyFuses: async () => { fuseChecks += 1; }
    });

    assert.equal(first.root, targetRoot);
    assert.equal(first.data, join(targetRoot, "Preview Data"));
    assert.equal(fuseChecks, 2);
    assert.equal(await readFile(join(targetRoot, "portable.json"), "utf8"), PREVIEW_MARKER);
    assert.equal(await readFile(join(targetRoot, "App", "polyask-desktop.exe"), "utf8"), "exe-v1");
    assert.match(await readFile(join(targetRoot, "README-PREVIEW.txt"), "utf8"), /Preview Data/);
    await assert.rejects(stat(join(targetRoot, "Preview Data")), /ENOENT/);

    await mkdir(join(targetRoot, "Preview Data"), { recursive: true });
    await writeFile(join(targetRoot, "Preview Data", "polyask.sqlite"), "keep-preview-history", "utf8");
    await writeFile(join(packageV1, "polyask-desktop.exe"), "exe-v2", "utf8");

    await stagePreviewDirectory({
      packageDir: packageV1,
      targetRoot,
      verifyFuses: async () => undefined
    });

    assert.equal(await readFile(join(targetRoot, "App", "polyask-desktop.exe"), "utf8"), "exe-v2");
    assert.equal(await readFile(join(targetRoot, "Preview Data", "polyask.sqlite"), "utf8"), "keep-preview-history");
    await assert.rejects(stat(join(targetRoot, "App.staging")), /ENOENT/);
    await assert.rejects(stat(join(targetRoot, "App.previous")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validatePreviewTargetRoot blocks non-Preview names, formal overlaps, and unrecognized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-win-preview-guard-"));
  try {
    await assert.rejects(
      validatePreviewTargetRoot("relative/PolyAsk-Preview"),
      /preview_target_invalid/
    );
    await assert.rejects(
      validatePreviewTargetRoot(join(root, "PolyAsk")),
      /preview_target_must_be_polyask_preview/
    );
    await assert.rejects(
      validatePreviewTargetRoot(join(root, "Roaming", "PolyAsk", "PolyAsk-Preview")),
      /preview_target_overlaps_formal/
    );
    await assert.rejects(
      validatePreviewTargetRoot(
        join(root, "Formal", "PolyAsk-Preview"),
        [join(root, "Formal")]
      ),
      /preview_target_overlaps_formal/
    );

    const polluted = join(root, "Polluted", "PolyAsk-Preview");
    await mkdir(polluted, { recursive: true });
    await writeFile(join(polluted, "important-notes.docx"), "user-file", "utf8");
    await assert.rejects(
      validatePreviewTargetRoot(polluted),
      /preview_target_unrecognized/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stagePreviewDirectory aborts without touching existing App when preview process is running or fuses fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyask-win-preview-abort-"));
  try {
    const packageDir = await createFakePackage(root, "new-exe");
    const targetRoot = join(root, "PolyAsk-Preview");
    await mkdir(join(targetRoot, "App"), { recursive: true });
    await writeFile(join(targetRoot, "App", "polyask-desktop.exe"), "running-exe", "utf8");

    await assert.rejects(
      stagePreviewDirectory({
        packageDir,
        targetRoot,
        isPreviewRunning: async (exePath) => {
          assert.equal(exePath, join(targetRoot, "App", "polyask-desktop.exe"));
          return true;
        },
        verifyFuses: async () => undefined
      }),
      /preview_process_running/
    );
    assert.equal(await readFile(join(targetRoot, "App", "polyask-desktop.exe"), "utf8"), "running-exe");

    await assert.rejects(
      stagePreviewDirectory({
        packageDir,
        targetRoot,
        isPreviewRunning: async () => false,
        verifyFuses: async () => {
          const err = new Error("preview_cookie_encryption_required");
          err.code = "preview_cookie_encryption_required";
          throw err;
        }
      }),
      /preview_cookie_encryption_required/
    );
    assert.equal(await readFile(join(targetRoot, "App", "polyask-desktop.exe"), "utf8"), "running-exe");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
