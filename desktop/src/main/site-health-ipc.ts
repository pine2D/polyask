import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { ViewManager } from "./view-manager";
import { runtimeProcessDiagnostics } from "./runtime-process-diagnostics";
import { captureLocateDiagnostics } from "./capture-locate-diagnostics";
import { registerSiteInspectionIpc } from "./site-inspection-ipc";
import { exportSiteDomSnapshot } from "./site-snapshot-service";

interface SiteHealthIpcOptions {
  readonly manager: ViewManager;
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly window?: BrowserWindow;
  readonly appVersion?: string;
}

function siteList(value: unknown): SiteKey[] | null {
  if (!Array.isArray(value) || value.length > SITE_KEYS.length) return null;
  if (!value.every((site) => typeof site === "string" && SITE_KEYS.includes(site as SiteKey))) return null;
  if (new Set(value).size !== value.length) return null;
  return value as SiteKey[];
}

export function registerSiteHealthIpc(options: SiteHealthIpcOptions): () => void {
  const disposeInspection = registerSiteInspectionIpc(options);
  ipcMain.handle("polyask:runtime-process-failures", event => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return runtimeProcessDiagnostics.snapshot();
  });
  ipcMain.handle("polyask:capture-locate-counts", event => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return captureLocateDiagnostics.snapshot();
  });
  ipcMain.handle("polyask:site-health", (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    const sites = siteList(value);
    if (!sites) throw new Error("invalid_sites");
    return options.manager.checkHealth(sites);
  });
  ipcMain.handle("polyask:reload-site", (event, value: unknown, ignoreCache?: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (typeof value !== "string" || !SITE_KEYS.includes(value as SiteKey)) throw new Error("invalid_site");
    return options.manager.reload(value as SiteKey, ignoreCache === true);
  });
  ipcMain.handle("polyask:clear-site-data", (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (typeof value !== "string" || !SITE_KEYS.includes(value as SiteKey)) throw new Error("invalid_site");
    return options.manager.clearSiteData(value as SiteKey);
  });
  ipcMain.handle("polyask:export-site-snapshot", async (event, value: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (typeof value !== "string" || !SITE_KEYS.includes(value as SiteKey)) throw new Error("invalid_site");
    const site = value as SiteKey;
    return exportSiteDomSnapshot({
      site,
      collect: (target) => options.manager.sampleSnapshot(target, options.appVersion ?? "0.0.0"),
      choosePath: async (defaultFilename) => {
        if (!options.window || options.window.isDestroyed()) return null;
        const result = await dialog.showSaveDialog(options.window, {
          defaultPath: defaultFilename,
          filters: [{ name: "JSON", extensions: ["json"] }]
        });
        return result.canceled || !result.filePath ? null : result.filePath;
      }
    });
  });
  return () => {
    disposeInspection();
    ipcMain.removeHandler("polyask:runtime-process-failures");
    ipcMain.removeHandler("polyask:capture-locate-counts");
    ipcMain.removeHandler("polyask:site-health");
    ipcMain.removeHandler("polyask:reload-site");
    ipcMain.removeHandler("polyask:clear-site-data");
    ipcMain.removeHandler("polyask:export-site-snapshot");
  };
}
