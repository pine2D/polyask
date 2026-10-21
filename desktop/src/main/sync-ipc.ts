import { ipcMain } from "electron";

import { questionIdValid } from "../shared/question-history";
import { CLEAR_REMOTE_CONFIRMATION } from "../shared/sync";
import type { RuntimeInfo } from "../shared/runtime";
import type { SyncEngine } from "./sync-engine";

interface SyncIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}

interface SyncIpcOptions {
  readonly sync: SyncEngine;
  readonly runtime: RuntimeInfo;
  readonly trusted: (event: SyncIpcEvent) => boolean;
}

const CHANNELS = [
  "polyask:sync-connect",
  "polyask:sync-now",
  "polyask:sync-disconnect",
  "polyask:sync-clear",
  "polyask:sync-diagnostics",
  "polyask:sync-images",
  "polyask:question-fetch-attachments"
] as const;

export function registerSyncIpc(options: SyncIpcOptions): () => void {
  ipcMain.handle(CHANNELS[0], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.connect();
  });
  ipcMain.handle(CHANNELS[1], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.syncNow();
  });
  ipcMain.handle(CHANNELS[2], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.disconnect();
  });
  ipcMain.handle(CHANNELS[3], (event, confirmation: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (confirmation !== CLEAR_REMOTE_CONFIRMATION) throw new Error("invalid_clear_confirmation");
    return options.sync.clearRemote();
  });
  ipcMain.handle(CHANNELS[4], (event) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return options.sync.diagnostics(options.runtime);
  });
  ipcMain.handle(CHANNELS[5], (event, enabled: unknown, confirmed: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (typeof enabled !== "boolean" || (enabled && confirmed !== true)) throw new Error("invalid_image_sync_setting");
    return options.sync.setImageSyncEnabled(enabled);
  });
  ipcMain.handle(CHANNELS[6], (event, id: unknown) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    if (!questionIdValid(id)) throw new Error("invalid_question");
    return options.sync.fetchQuestionAttachments(id);
  });
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}
