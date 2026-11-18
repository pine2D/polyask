import { QuestionHistoryService } from "./question-history-service";
import { captureLocateDiagnostics } from "./capture-locate-diagnostics";
import { safeQuestionUrl } from "./question-navigation";
import { BackupService } from "./backup-service";
import { TaskFolderService } from "./task-folder-service";
import { randomUUID } from "node:crypto";
import type { DesktopDatabase } from "./database";
import { ArchiveService } from "./archive-service";
import { AutoBackupService } from "./auto-backup-service";
import { DecisionService } from "./decision-service";
import { RecentPromptService } from "./recent-prompt-service";
import { PromptLibraryService } from "./prompt-library-service";

export function createLocalDataServices(database: DesktopDatabase, options?: { readonly userDataPath?: string }) {
  const deviceId = () => {
    const stored = database.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    return database.meta.put("deviceId", randomUUID());
  };
  deviceId();
  const questions = new QuestionHistoryService(database.questions, { deviceId, safeUrl: safeQuestionUrl,
    onLocate: (site, locate) => captureLocateDiagnostics.record(site, locate),
    onReason: (site, reason) => captureLocateDiagnostics.recordReason(site, reason),
    onSlowObserver: (site, token, count) => captureLocateDiagnostics.recordSlow(site, token, count) });
  const archives = new ArchiveService(database.archives, { deviceId });
  const recentPrompts = new RecentPromptService(database.history, { deviceId });
  const promptLibrary = new PromptLibraryService(database.state, database.meta, recentPrompts);
  const decisions = new DecisionService(database.decisions, archives, { deviceId });
  const folders = new TaskFolderService(database.folders, archives, decisions, { deviceId });
  const backup = new BackupService(database, { deviceId });
  const autoBackup = new AutoBackupService(database, backup, { userDataPath: options?.userDataPath });
  return { deviceId, questions, archives, recentPrompts, promptLibrary, decisions, folders, backup, autoBackup };
}
