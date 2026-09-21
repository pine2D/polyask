import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { OperationGate } from "../shared/operation-gate";
import { questionIdValid, type QuestionFilters } from "../shared/question-history";
import type { QuestionHistoryService } from "./question-history-service";
import type { ViewManager } from "./view-manager";
import { QuestionRestoreService } from "./question-restore-service";
import type { WorkspaceService } from "./workspace-service";

const channels = ["polyask:question-list", "polyask:question-get", "polyask:question-preview", "polyask:question-restore", "polyask:question-cancel", "polyask:question-delete", "polyask:question-panel", "polyask:question-legacy"] as const;
export function registerQuestionHistoryIpc(options: {
  questions: QuestionHistoryService; manager: ViewManager; workspace: WorkspaceService; gate: OperationGate;
  flush: (sites: readonly import("../shared/contracts").SiteKey[]) => Promise<void>;
  window: BrowserWindow; trusted: (event: IpcMainInvokeEvent) => boolean; publishWorkspace: () => unknown;
}): () => void {
  const { questions, manager, workspace, gate } = options;
  questions.setFailureHandler(() => { if (!options.window.isDestroyed()) options.window.webContents.send("polyask:question-save-failed"); });
  const restore = new QuestionRestoreService(questions.repository, {
    selection: () => workspace.getState().selectedSites,
    select: sites => { manager.setSurface("sites"); workspace.setSelection(sites); options.publishWorkspace(); manager.setSurface("question-history"); },
    context: site => manager.historyAccess.context(site),
    navigate: (site, url) => manager.historyAccess.navigate(site, url),
    stop: (site, contentsId) => manager.historyAccess.stop(site, contentsId),
    beforeNavigate: async sites => { await options.flush(sites); questions.cancel(sites); }
  });
  const id = (v: unknown): string => { if (!questionIdValid(v)) throw new Error("invalid_question"); return v; };
  const handle = (channel: typeof channels[number], action: (value: any) => unknown) => ipcMain.handle(channel, (event, value) => {
    if (!options.trusted(event)) throw new Error("untrusted_sender");
    return action(value);
  });
  handle(channels[0], value => {
    const v = value && typeof value === "object" ? value as QuestionFilters : {};
    if ((v.query !== undefined && typeof v.query !== "string") || (v.cursor !== undefined && typeof v.cursor !== "string") || (v.limit !== undefined && typeof v.limit !== "number")) throw new Error("invalid_question_query");
    return questions.repository.search(v);
  });
  handle(channels[1], value => questions.repository.detail(id(value?.questionId), value?.answerId === undefined ? undefined : id(value.answerId)));
  handle(channels[2], value => restore.preview(id(value?.questionId), value?.answerId === undefined ? undefined : id(value.answerId)));
  handle(channels[3], value => gate.run(() => restore.restore(id(value?.token), value?.confirmed === true)));
  handle(channels[4], () => restore.cancel());
  handle(channels[5], value => { restore.cancel(); return questions.delete(id(value)); });
  handle(channels[6], value => { if (typeof value !== "boolean") throw new Error("invalid_question"); manager.historyAccess.setPanelOpen(value); });
  handle(channels[7], value => {
    if (value && ((value.query !== undefined && typeof value.query !== "string") || (value.cursor !== undefined && typeof value.cursor !== "string"))) throw new Error("invalid_question_query");
    return questions.repository.legacy(value ?? {});
  });
  return () => { questions.setFailureHandler(null); restore.cancel(); for (const channel of channels) ipcMain.removeHandler(channel); };
}
