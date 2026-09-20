import { randomUUID } from "node:crypto";
import type { DesktopDatabase } from "./database";
import { ArchiveService } from "./archive-service";
import { DecisionService } from "./decision-service";
import { HistoryService } from "./history-service";
import { PromptLibraryService } from "./prompt-library-service";

export function createLocalDataServices(database: DesktopDatabase) {
  const deviceId = () => {
    const stored = database.meta.get<unknown>("deviceId");
    if (typeof stored === "string" && stored) return stored;
    return database.meta.put("deviceId", randomUUID());
  };
  deviceId();
  const archives = new ArchiveService(database.archives, { deviceId });
  const history = new HistoryService(database.history, { deviceId });
  const promptLibrary = new PromptLibraryService(database.state, database.meta, history);
  const decisions = new DecisionService(database.decisions, archives, { deviceId });
  return { deviceId, archives, history, promptLibrary, decisions };
}
