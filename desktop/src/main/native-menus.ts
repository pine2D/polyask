import type { BrowserWindow } from "electron";

import { commandAccelerator, commandById, type CommandId } from "../shared/commands";
import type { CommandPaletteShortcutMode } from "../shared/command-palette-shortcut";
import type { DesktopCopy } from "../shared/copy";
import { MORE_MENU_GROUPS } from "../shared/more-menu";
import { shortcutLabel } from "../shared/shortcut-label";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { showPlatinumPopupMenu, type PlatinumPopupEntry } from "./platinum-popup-menu";

export function buildGroupMenuEntries(
  groups: readonly ActiveWorkspaceGroup[],
  copy: DesktopCopy
): PlatinumPopupEntry<string>[] {
  return groups.length
    ? groups.map((group) => ({ id: group.id, label: group.name, enabled: true }))
    : [{ label: copy.noSavedGroups, enabled: false }];
}

export function showGroupMenu(
  window: BrowserWindow,
  groups: readonly ActiveWorkspaceGroup[],
  copy: DesktopCopy,
  anchor?: unknown
): Promise<string | null> {
  return showPlatinumPopupMenu(window, buildGroupMenuEntries(groups, copy), anchor, "start");
}

export function buildCommandMenuEntries(
  value: unknown,
  copy: DesktopCopy,
  mode: CommandPaletteShortcutMode = "standard",
  platform: NodeJS.Platform = process.platform
): PlatinumPopupEntry<CommandId>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("invalid_command_menu");
  const ids = value.filter((id): id is CommandId => typeof id === "string" && !!commandById(id));
  if (ids.length !== value.length || new Set(ids).size !== ids.length) throw new Error("invalid_command_menu");
  const isMac = platform === "darwin";
  const items = ids.map((id) => {
    const command = commandById(id)!;
    const rawAccel = commandAccelerator(id, platform, mode);
    return {
      id,
      label: copy[command.labelKey],
      accelerator: rawAccel ? shortcutLabel(rawAccel, isMac) : undefined,
      section: MORE_MENU_GROUPS.findIndex((group) => group.includes(id))
    };
  });
  return items.flatMap((item, index): PlatinumPopupEntry<CommandId>[] => [
    ...(index > 0 && item.section !== items[index - 1]!.section ? [{ type: "separator" as const }] : []),
    { id: item.id, label: item.label, enabled: true, accelerator: item.accelerator }
  ]);
}

export function showCommandMenu(
  window: BrowserWindow,
  value: unknown,
  copy: DesktopCopy,
  mode: CommandPaletteShortcutMode = "standard",
  anchor?: unknown
): Promise<CommandId | null> {
  return showPlatinumPopupMenu(window, buildCommandMenuEntries(value, copy, mode), anchor, "end");
}
