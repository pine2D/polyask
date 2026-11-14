import { dialog, ipcMain, type BrowserWindow } from "electron";

import type { AutoBackupService } from "./auto-backup-service";

interface AutoBackupIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}

const CHANNELS = [
  "polyask:auto-backup-list",
  "polyask:auto-backup-preview",
  "polyask:auto-backup-export"
] as const;

const CODES = new Set([
  "backup_invalid",
  "backup_version",
  "backup_stale",
  "backup_missing",
  "backup_too_large",
  "backup_read_failed",
  "backup_write_failed",
  "backup_busy",
  "invalid_request"
]);

function validId(value: unknown): string {
  if (typeof value !== "string" || !/^auto-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$/.test(value)) {
    throw new Error("invalid_request");
  }
  return value;
}

export function registerAutoBackupIpc(options: {
  readonly window: BrowserWindow;
  readonly autoBackup: AutoBackupService;
  readonly trusted: (event: AutoBackupIpcEvent) => boolean;
}): () => void {
  let busy = false;
  let disposed = false;

  const handle = (
    channel: typeof CHANNELS[number],
    action: (value: unknown) => unknown | Promise<unknown>
  ): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      if (!options.trusted(event)) throw new Error("untrusted_sender");
      if (disposed) throw new Error("backup_busy");
      if (channel === "polyask:auto-backup-list") {
        try { return await action(value); }
        catch (error) { throw new Error(error instanceof Error && CODES.has(error.message) ? error.message : "backup_failed"); }
      }
      if (busy) throw new Error("backup_busy");
      busy = true;
      try { return await action(value); }
      catch (error) { throw new Error(error instanceof Error && CODES.has(error.message) ? error.message : "backup_failed"); }
      finally { busy = false; }
    });
  };

  handle(CHANNELS[0], async () => options.autoBackup.list());

  handle(CHANNELS[1], async (value) => {
    const id = validId(value);
    return options.autoBackup.preview(id);
  });

  handle(CHANNELS[2], async (value) => {
    const id = validId(value);
    const summary = await options.autoBackup.getSummary(id);
    const result = await dialog.showSaveDialog(options.window, {
      defaultPath: summary.filename,
      filters: [{ name: "PolyAsk", extensions: ["polyask"] }]
    });
    if (result.canceled || !result.filePath || disposed) return false;
    await options.autoBackup.exportCopy(id, result.filePath);
    return summary.textOnly ? "text-only" : true;
  });

  return () => {
    disposed = true;
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
  };
}
