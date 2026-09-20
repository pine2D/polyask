import type { CommandId } from "./commands";

// Keep related actions together even when unavailable commands are filtered out.
export const MORE_MENU_GROUPS: readonly (readonly CommandId[])[] = [
  ["collect-compare", "collect-answers", "collect-synthesis"],
  ["retry-failed", "next-unfinished", "next-failed", "new-session"],
  ["open-command-palette", "open-shortcuts", "open-getting-started", "open-settings", "check-updates"]
];

export const MORE_MENU_IDS: readonly CommandId[] = MORE_MENU_GROUPS.flat();
