import assert from "node:assert/strict";
import React from "react";
import test from "node:test";
import { FeedbackProvider, usePreviewBadge } from "../src/renderer/feedback-provider";
import { setShellApi } from "../src/renderer/shell-api";
import type { AutoBackupSummary, BackupPreview } from "../src/shared/backup";
import { getCopy } from "../src/shared/copy";
import { mountDom } from "./ui/dom-harness";
import { settingsButton, settingsElement, settingsRuntime, settingsShell } from "./ui/settings-dom";

const SNAPSHOTS: readonly AutoBackupSummary[] = [
  {
    id: "auto-20261114-093000-a1b2c3d4",
    filename: "polyask-auto-v1.33.1-to-v1.34.0-2026-11-14.polyask",
    fromVersion: "1.33.1",
    toVersion: "1.34.0",
    fromDbSchema: 4,
    toDbSchema: 4,
    fromSyncSchema: 7,
    toSyncSchema: 7,
    createdAt: 1_790_208_000_000,
    sizeBytes: 184_320,
    textOnly: false
  },
  {
    id: "auto-20261102-211500-e5f6a7b8",
    filename: "polyask-auto-before-v1.33.1-2026-11-02.polyask",
    fromVersion: null,
    toVersion: "1.33.1",
    fromDbSchema: 4,
    toDbSchema: 4,
    fromSyncSchema: null,
    toSyncSchema: 7,
    createdAt: 1_789_200_000_000,
    sizeBytes: 42_500,
    textOnly: true
  }
];

for (const locale of ["en", "zh-CN", "zh-TW"] as const) {
  test(`AutoBackupCard renders localized empty state in ${locale}`, async () => {
    const localized = getCopy(locale);
    settingsShell({ listAutoBackups: async () => [] });
    const h = await mountDom(settingsElement({ initialSection: "backup", copy: localized, locale }));
    try {
      const empty = h.document.querySelector("[data-auto-backup-empty]");
      assert.equal(empty !== null, true);
      assert.equal(empty?.querySelector("strong")?.textContent, localized.autoBackupEmptyTitle);
    } finally {
      await h.close();
      setShellApi(null);
    }
  });
}

test("AutoBackupCard lists snapshots, opens BackupWorkspace for compare/restore, and exports copies", async () => {
  const copy = getCopy("zh-CN");
  const previewPayload: BackupPreview = {
    token: "auto-tok-1",
    filename: SNAPSHOTS[0].filename,
    exportedAt: SNAPSHOTS[0].createdAt,
    items: [
      {
        key: "folder:f-1",
        kind: "folder",
        id: "f-1",
        title: "升级前研究夹",
        status: "new",
        local: null,
        backup: { name: "升级前研究夹" }
      }
    ]
  };
  const exportedIds: string[] = [];
  settingsShell({
    listAutoBackups: async () => SNAPSHOTS,
    previewAutoBackup: async (id: string) => {
      assert.equal(id, SNAPSHOTS[0].id);
      return previewPayload;
    },
    previewBackupSelection: async (_token: string, keys: string[]) => ({
      imported: keys.length,
      skipped: 0,
      keys
    }),
    exportAutoBackup: async (id: string) => {
      exportedIds.push(id);
      return id === SNAPSHOTS[1].id ? "text-only" : true;
    }
  });

  const h = await mountDom(settingsElement({ initialSection: "backup", copy, locale: "zh-CN" }));
  try {
    const rows = h.document.querySelectorAll(".auto-backup-item");
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.querySelector(".auto-backup-version")?.textContent, "v1.33.1 → v1.34.0");
    assert.equal(rows[0]?.querySelector(".auto-backup-tag") === null, true);
    assert.equal(rows[1]?.querySelector(".auto-backup-version")?.textContent, "升级至 v1.33.1 前自动留存");
    assert.equal(rows[1]?.querySelector(".auto-backup-tag")?.textContent, copy.autoBackupTextOnlyTag);

    const exportButtons = [...h.document.querySelectorAll<HTMLButtonElement>(".auto-backup-item button")]
      .filter((btn) => btn.textContent === copy.autoBackupExport);
    await h.click(exportButtons[0]!);
    assert.equal(h.document.querySelector(".archive-status")?.textContent, copy.backupExported);
    await h.click(exportButtons[1]!);
    assert.equal(h.document.querySelector(".archive-status")?.textContent, copy.backupTextOnlyExported);
    assert.deepEqual(exportedIds, [SNAPSHOTS[0].id, SNAPSHOTS[1].id]);

    const restoreButtons = [...h.document.querySelectorAll<HTMLButtonElement>(".auto-backup-item button")]
      .filter((btn) => btn.textContent === copy.autoBackupRestore);
    await h.click(restoreButtons[0]!);
    assert.equal(h.document.querySelector(".backup-workspace") !== null, true);
    await h.click(settingsButton(h.document, copy.cancel));
    assert.equal(h.document.querySelector(".backup-workspace") === null, true);
  } finally {
    await h.close();
    setShellApi(null);
  }
});

test("preview visual badge and window title prefix appear in preview mode and stay invisible in formal mode", async () => {
  const copy = getCopy("zh-CN");
  function RuntimeConsumer({ active }: { active: boolean }) {
    usePreviewBadge(active);
    return <main>App</main>;
  }

  const formal = await mountDom(<FeedbackProvider copy={copy}><RuntimeConsumer active={false} /></FeedbackProvider>);
  try {
    assert.equal(formal.document.querySelector(".preview-badge") === null, true);
    assert.equal(formal.document.title, copy.appTitle);
  } finally {
    await formal.close();
  }

  const preview = await mountDom(<FeedbackProvider copy={copy}><RuntimeConsumer active={true} /></FeedbackProvider>);
  try {
    assert.equal(preview.document.querySelector(".preview-badge")?.textContent, copy.previewBadge);
    assert.equal(preview.document.title, `【试玩】${copy.appTitle}`);
  } finally {
    await preview.close();
  }

  settingsShell({ listAutoBackups: async () => [] });
  const settingsPreview = await mountDom(settingsElement({
    copy,
    locale: "zh-CN",
    runtime: { ...settingsRuntime, distribution: "portable", preview: true }
  }));
  try {
    assert.equal(settingsPreview.document.querySelector(".settings-product .preview-badge")?.textContent, copy.previewBadge);
    assert.equal(settingsPreview.document.querySelector(".settings-product span")?.textContent?.includes(copy.previewMode), true);
  } finally {
    await settingsPreview.close();
    setShellApi(null);
  }
});
