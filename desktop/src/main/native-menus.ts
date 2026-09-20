import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

import { commandAccelerator, commandById, type CommandId } from "../shared/commands";
import type { DesktopCopy } from "../shared/copy";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { MORE_MENU_GROUPS } from "../shared/more-menu";

function popupChoice<Id extends string>(
  window: BrowserWindow,
  items: readonly { readonly id: Id; readonly label: string; readonly enabled?: boolean; readonly accelerator?: string; readonly section?: number }[]
): Promise<Id | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Id | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const menu = Menu.buildFromTemplate(items.flatMap((item, index): MenuItemConstructorOptions[] => [
      ...(index > 0 && item.section !== items[index - 1].section ? [{ type: "separator" as const }] : []), {
        label: item.label,
        enabled: item.enabled ?? true,
        accelerator: item.accelerator,
        // The application menu owns shortcut dispatch; this popup only displays it.
        registerAccelerator: false,
        click: () => finish(item.id)
      }
    ]));
    menu.popup({ window, callback: () => finish(null) });
  });
}

export function showGroupMenu(
  window: BrowserWindow,
  groups: readonly ActiveWorkspaceGroup[],
  copy: DesktopCopy
): Promise<string | null> {
  return popupChoice(window, groups.length
    ? groups.map((group) => ({ id: group.id, label: group.name }))
    : [{ id: "none", label: copy.noSavedGroups, enabled: false }]);
}

export function showCommandMenu(
  window: BrowserWindow,
  value: unknown,
  copy: DesktopCopy
): Promise<CommandId | null> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error("invalid_command_menu");
  const ids = value.filter((id): id is CommandId => typeof id === "string" && !!commandById(id));
  if (ids.length !== value.length || new Set(ids).size !== ids.length) throw new Error("invalid_command_menu");
  return popupChoice(window, ids.map((id) => {
    const command = commandById(id)!;
    return { id, label: copy[command.labelKey], accelerator: commandAccelerator(id, process.platform),
      section: MORE_MENU_GROUPS.findIndex((group) => group.includes(id)) };
  }));
}
