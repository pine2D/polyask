import { setShellApi } from "../../src/renderer/shell-api";
import { SITES } from "../../src/main/sites";
import type { CommandId } from "../../src/shared/commands";
import type { PolyAskDesktopApi } from "../../src/preload/shell";
import { getCopy } from "../../src/shared/copy";
import { createSyncDiagnosticSnapshot } from "../../src/shared/sync-diagnostics";

const status = { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false,
  oauthConfigured: false, secureTokenStorage: false } as const;
let command: (id: CommandId) => void = () => {};
let sends = 0, resets = 0;
let pageError = "";
let finishReset: (() => void) | undefined, boundaryNavigation = false;
const surfaces: string[] = [], commands: CommandId[] = [];
const emitCommand = (id: CommandId) => { commands.push(id); command(id); };
window.addEventListener("error", event => { pageError = event.message; });
setShellApi(new Proxy({
  bootstrap: async () => ({ runtime: { version: "fixture", distribution: "installed" }, sites: SITES,
    statuses: [], layout: { mode: "overview", focused: "claude", page: 0, pageCount: 1, placements: [] },
    workspace: { selectedSites: ["claude"], groups: [], tier: null }, promptLibrary: { templates: [], history: [] },
    pendingSynthesis: null, sync: status }),
  setDisplayPreferences: async (value: unknown) => value,
  setDrawerOpen: () => {}, setComposerExpanded: () => {}, setCompletionNotifications: () => {},
  setSurface: (value: string) => { surfaces.push(value); },
  broadcast: async () => { sends++; return [{ site: "claude", ok: false, code: "submit_unconfirmed" }]; },
  getLocalDataStats: async () => ({ history: 1, archives: 0, decisions: 0, folders: 0, answers: 1, memberships: 0,
    drafts: 0, reset: { preferences: 0, answers: 1, memberships: 0, templates: 0, groups: 0, workspace: 1 } }),
  resetLocalData: () => {
    resets++;
    const response = new Promise<typeof status>(resolve => { finishReset = () => resolve(status); });
    // Exercise the registered shell onCommand listener before React can commit
    // the new busy state, as well as during the deferred IPC in the runtime.
    const before = surfaces.length;
    emitCommand("open-archive"); emitCommand("open-command-palette");
    boundaryNavigation = surfaces.length !== before;
    return response;
  },
  syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, { version: "fixture", distribution: "installed" }),
  onCommand: (listener: typeof command) => { command = listener; return () => {}; }
}, { get: (target, key) => Reflect.get(target, key) ?? (String(key).startsWith("on") ? () => () => {} : async () => []) }) as unknown as PolyAskDesktopApi);

window.addEventListener("input", event => { (window as any).resetInputTrusted = event.isTrusted; });
window.addEventListener("keyup", event => { (window as any).resetKeyUpTrusted = event.isTrusted; });
(window as any).localDataResetFixture = {
  copy: getCopy("en"), command: emitCommand,
  finishReset: () => { finishReset?.(); finishReset = undefined; },
  result: () => ({ sends, resets, pageError, resetPending: !!finishReset, boundaryNavigation,
    surfaces: surfaces.slice(), commands: commands.slice() }),
  // Synthetic attachment setup preserves the old reset regression; text and
  // reset confirmation are driven by trusted Electron input in the runtime.
  seedImage: () => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII="), char => char.charCodeAt(0));
    transfer.items.add(new File([bytes], "old.png", { type: "image/png" }));
    document.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')!
      .dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  }
};
void import("../../src/renderer/index").catch(error => { pageError = String(error); });
