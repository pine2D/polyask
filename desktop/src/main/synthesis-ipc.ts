import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import type { OperationGate } from "../shared/operation-gate";
import type { BroadcastCoordinator } from "./broadcast";
import type { SynthesisService } from "./synthesis-service";

const HANDLERS = ["polyask:synthesis-send", "polyask:synthesis-collect", "polyask:synthesis-save"] as const;
const LISTENERS = ["polyask:synthesis-cancel"] as const;

/**
 * 辅助综合的受信 IPC。取消只作用于综合自己的派发与导航：群发的 polyask:cancel 会把上一轮「提交未确认」站
 * holdSubmission（迟到确认作废），综合取消不得连带（2026-10-10 审查 R10）。
 */
export function registerSynthesisIpc(options: {
  synthesis: Pick<SynthesisService, "send" | "collect" | "save" | "cancel">;
  synthesisCoordinator: Pick<BroadcastCoordinator, "cancel">;
  gate: Pick<OperationGate, "run">;
  resetting: () => boolean;
  trusted: (event: IpcMainInvokeEvent | IpcMainEvent) => boolean;
}): () => void {
  const { synthesis, trusted } = options;
  ipcMain.handle("polyask:synthesis-send", (event, value: unknown) => {
    if (!trusted(event)) throw new Error("untrusted_sender");
    if (options.resetting()) throw new Error("operation_busy");
    return options.gate.run(() => synthesis.send(value));
  });
  ipcMain.handle("polyask:synthesis-collect", (event) => {
    if (!trusted(event)) throw new Error("untrusted_sender");
    return synthesis.collect();
  });
  ipcMain.handle("polyask:synthesis-save", (event, value: unknown) => {
    if (!trusted(event) || typeof value !== "boolean") throw new Error("invalid_synthesis_save");
    return synthesis.save(value);
  });
  ipcMain.on("polyask:synthesis-cancel", (event) => {
    if (!trusted(event)) return;
    options.synthesisCoordinator.cancel();
    synthesis.cancel();
  });
  return () => {
    for (const channel of HANDLERS) ipcMain.removeHandler(channel);
    for (const channel of LISTENERS) ipcMain.removeAllListeners(channel);
  };
}
