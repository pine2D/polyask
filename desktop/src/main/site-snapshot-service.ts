import { writeFile } from "node:fs/promises";
import type { WebContentsView } from "electron";

import type { SiteKey } from "../shared/contracts";
import type { SiteSnapshotSiteCommand, SiteStatus } from "../shared/protocol";
import {
  SITE_SNAPSHOT_KIND,
  SITE_SNAPSHOT_SCHEMA,
  verifySanitizedSnapshot,
  type SiteDomSnapshotFile,
  type SiteDomSnapshotSample,
  type SiteSnapshotErrorCode,
  type SiteSnapshotExportResult
} from "../shared/site-snapshot";
import { navigationDisposition } from "./navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { SITES } from "./sites";

const SNAPSHOT_COMMAND_TIMEOUT_MS = 5_000;

export type CollectedSiteSnapshot =
  | { readonly ok: true; readonly snapshot: SiteDomSnapshotFile; readonly serialized: string }
  | { readonly ok: false; readonly code: SiteSnapshotErrorCode | "no_view" | "not_ready" | "timeout" };

function mapSampleFailureCode(value: unknown): SiteSnapshotErrorCode | "not_ready" | "timeout" {
  if (value === "snapshot_privacy_blocked" || value === "snapshot_too_large" || value === "snapshot_failed") return value;
  if (value === "not_ready" || value === "timeout") return value;
  return "snapshot_failed";
}

export async function collectSiteDomSnapshot(
  site: SiteKey,
  view: WebContentsView | undefined,
  pageStatus: SiteStatus | undefined,
  commands: SiteCommandChannel,
  appVersion: string,
  now: () => number = Date.now
): Promise<CollectedSiteSnapshot> {
  const definition = SITES.find((candidate) => candidate.key === site);
  if (!definition || !view || view.webContents.isDestroyed()) {
    return { ok: false, code: "no_view" };
  }
  const phase = pageStatus?.phase ?? "loading";
  const initialUrl = view.webContents.getURL();
  if (navigationDisposition(definition, initialUrl) !== "site" || ["loading", "failed", "crashed"].includes(phase)) {
    return { ok: false, code: "not_ready" };
  }

  const command: SiteSnapshotSiteCommand = {
    source: "AMS",
    cmd: "siteSnapshot",
    deadline: now() + SNAPSHOT_COMMAND_TIMEOUT_MS
  };
  const response = await commands.send(view.webContents, command, {
    timeoutResult: { ok: false, code: "timeout" }
  });
  if (view.webContents.isDestroyed()
    || view.webContents.getURL() !== initialUrl
    || navigationDisposition(definition, view.webContents.getURL()) !== "site") {
    return { ok: false, code: "not_ready" };
  }

  const sample = response && typeof response === "object" ? (response as Partial<SiteDomSnapshotSample>) : null;
  if (!sample || sample.ok !== true || !sample.fixture || typeof sample.html !== "string") {
    return { ok: false, code: mapSampleFailureCode(sample?.code) };
  }

  const rawZoom = view.webContents.getZoomFactor();
  const zoomFactor = Number.isFinite(rawZoom) && rawZoom > 0 ? Number(rawZoom.toFixed(3)) : 1;
  const snapshot: SiteDomSnapshotFile = {
    schema: SITE_SNAPSHOT_SCHEMA,
    kind: SITE_SNAPSHOT_KIND,
    site,
    host: definition.host,
    path: sample.path ?? "/",
    capturedAt: sample.capturedAt ?? "",
    appVersion,
    viewport: sample.viewport ?? { width: 0, height: 0, devicePixelRatio: 0 },
    zoomFactor,
    diagnostics: sample.diagnostics ?? [],
    sampling: sample.sampling ?? "full-main",
    fixture: { ...sample.fixture, host: definition.host },
    html: sample.html
  };

  // 落盘前由主进程复核整份 JSON 与 HTML 白名单/敏感串，不合格直接拒绝且不打开保存框。
  const verdict = verifySanitizedSnapshot(snapshot, { site, host: definition.host });
  if (!verdict.ok) {
    return { ok: false, code: verdict.code };
  }

  return {
    ok: true,
    snapshot,
    serialized: `${JSON.stringify(snapshot, null, 2)}\n`
  };
}

export async function exportSiteDomSnapshot(options: {
  readonly site: SiteKey;
  readonly collect: (site: SiteKey) => Promise<CollectedSiteSnapshot>;
  readonly choosePath: (defaultFilename: string) => Promise<string | null>;
  readonly write?: (filePath: string, content: string) => Promise<void>;
}): Promise<SiteSnapshotExportResult> {
  const collected = await options.collect(options.site);
  if (!collected.ok) {
    return { status: "failed", code: collected.code };
  }
  const filename = `${options.site}-dom-snapshot-${collected.snapshot.capturedAt}.json`;
  let targetPath: string | null;
  try {
    targetPath = await options.choosePath(filename);
  } catch {
    return { status: "failed", code: "snapshot_failed" };
  }
  if (!targetPath) return { status: "cancelled" };
  try {
    const save = options.write ?? ((path: string, content: string) => writeFile(path, content, "utf8"));
    await save(targetPath, collected.serialized);
    return { status: "exported", filePath: targetPath };
  } catch {
    return { status: "failed", code: "snapshot_failed" };
  }
}
