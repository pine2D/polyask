import { ipcMain } from "electron";
import type { DecisionFilters } from "../shared/decision";
import type { DecisionService } from "./decision-service";

interface DecisionIpcEvent {
  readonly sender: Electron.WebContents;
  readonly senderFrame: Electron.WebFrameMain | null;
}
const CHANNELS = ["polyask:decision-search", "polyask:decision-get", "polyask:decision-create", "polyask:decision-update", "polyask:decision-delete", "polyask:decision-markdown"] as const;
const id = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 128) throw new Error("invalid_request");
  return value;
};
export function registerDecisionIpc(options: {
  readonly decisions: DecisionService;
  readonly trusted: (event: DecisionIpcEvent) => boolean;
}): () => void {
  const handle = (channel: typeof CHANNELS[number], run: (value: unknown) => unknown) => {
    ipcMain.handle(channel, (event, value: unknown) => {
      if (!options.trusted(event)) throw new Error("untrusted_sender");
      return run(value);
    });
  };
  handle(CHANNELS[0], value => options.decisions.search(value && typeof value === "object" ? value as DecisionFilters : {}));
  handle(CHANNELS[1], value => options.decisions.get(id(value)));
  handle(CHANNELS[2], value => options.decisions.create(value));
  handle(CHANNELS[3], value => {
    if (!value || typeof value !== "object") throw new Error("invalid_request");
    const v = value as {id?:unknown;input?:unknown};
    return options.decisions.update(id(v.id),v.input);
  });
  handle(CHANNELS[4], value => options.decisions.delete(id(value)));
  handle(CHANNELS[5], value => {
    if (!value || typeof value !== "object") throw new Error("invalid_request");
    const v = value as {id?:unknown;locale?:unknown};
    return options.decisions.exportMarkdown(id(v.id),typeof v.locale === "string" ? v.locale : "en");
  });
  return () => { for (const channel of CHANNELS) ipcMain.removeHandler(channel); };
}
