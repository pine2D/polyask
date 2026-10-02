import { setShellApi } from "../../src/renderer/shell-api";
import { SITES } from "../../src/main/sites";
import type { CommandId } from "../../src/shared/commands";
import type { PolyAskDesktopApi } from "../../src/preload/shell";
import { createSyncDiagnosticSnapshot } from "../../src/shared/sync-diagnostics";

const status = { state: "idle", connected: false, pending: 0, errorCount: 0, readOnly: false,
  oauthConfigured: false, secureTokenStorage: false } as const;
let command: (id: CommandId) => void = () => {};
let sends = 0;
let pageError = "";
window.addEventListener("error", event => { pageError = event.message; });
setShellApi(new Proxy({
  bootstrap: async () => ({ runtime: { version: "fixture", distribution: "installed" }, sites: SITES,
    statuses: [], layout: { mode: "overview", focused: "claude", page: 0, pageCount: 1, placements: [] },
    workspace: { selectedSites: ["claude"], groups: [], tier: null }, promptLibrary: { templates: [], history: [] },
    pendingSynthesis: null, sync: status }),
  setDisplayPreferences: async (value: unknown) => value,
  setDrawerOpen: () => {}, setComposerExpanded: () => {}, setCompletionNotifications: () => {}, setSurface: () => {},
  broadcast: async () => { sends++; return [{ site: "claude", ok: false, code: "submit_unconfirmed" }]; },
  resetLocalData: async () => status,
  syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, { version: "fixture", distribution: "installed" }),
  onCommand: (listener: typeof command) => { command = listener; return () => {}; }
}, { get: (target, key) => Reflect.get(target, key) ?? (String(key).startsWith("on") ? () => () => {} : async () => []) }) as unknown as PolyAskDesktopApi);

const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const wait = async (predicate: () => boolean, label: string) => {
  for (let count = 0; count < 150; count++) { if (predicate()) return; await pause(); }
  throw new Error(`timeout: ${label}; ${document.body.textContent}; ${pageError}`);
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label);
  if (!button) throw new Error(`missing ${label}`);
  button.click(); await pause();
};
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
(window as unknown as { resetResult: Promise<unknown> }).resetResult = (async () => {
  await import("../../src/renderer/index");
  await wait(() => !!document.querySelector("textarea[name=\"prompt\"]"), "bootstrap");
  const prompt = document.querySelector<HTMLTextAreaElement>("textarea[name=\"prompt\"]")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "Old question");
  prompt.dispatchEvent(new Event("input", { bubbles: true })); await pause();
  const transfer = new DataTransfer();
  const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII="), char => char.charCodeAt(0));
  transfer.items.add(new File([bytes], "old.png", { type: "image/png" }));
  prompt.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
  await wait(() => document.querySelector(".image-trigger")?.getAttribute("data-image-count") === "1", "selected image");
  prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  await wait(() => sends === 1 && !!document.querySelector(".retry-trigger"), "failed old run");
  command("open-settings"); await pause();
  await click("Reset all local data"); await click("Continue");
  await wait(() => !!document.querySelector(".settings-workspace") && !document.querySelector(".confirm-dialog"), "reset");
  document.querySelector<HTMLButtonElement>("[aria-label=\"Close settings\"]")!.click(); await pause();
  check(document.querySelector<HTMLTextAreaElement>("textarea[name=\"prompt\"]")!.value === "", "reset must clear text");
  check(document.querySelector(".image-trigger")?.getAttribute("data-image-count") === "0", "reset must clear old images");
  command("retry-failed"); await pause();
  check(sends === 1, "reset must make the previous retry unavailable");
  return { ok: true, sends };
})().catch(error => ({ ok: false, error: String(error) }));
