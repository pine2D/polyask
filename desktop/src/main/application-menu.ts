import type { MenuItemConstructorOptions } from "electron";
import { resolveCommands, commandAccelerator, type CommandId } from "../shared/commands";
import type { CommandPaletteShortcutMode } from '../shared/command-palette-shortcut';
import type { DesktopCopy } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";
import { VIEW_MENU_ITEMS, type ViewMenuAction } from "../shared/view-menu";

export function applicationMenu(
  platform: NodeJS.Platform, copy: DesktopCopy, display: DisplayPreferences,
  onDisplay: (value: DisplayPreferences) => void, dispatch: (id: CommandId) => void, appName: string,
  onViewAction: (action: ViewMenuAction) => void, mode: CommandPaletteShortcutMode = 'standard'
): MenuItemConstructorOptions[] {
  return [
    ...(platform === "darwin"
      ? [{ label: appName, submenu: [
          { role: "about" as const }, { type: "separator" as const },
          { label: copy.settings, accelerator: commandAccelerator("open-settings", platform), click: () => dispatch("open-settings") },
          { type: "separator" as const }, { role: "services" as const }, { type: "separator" as const },
          { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const },
          { type: "separator" as const }, { role: "quit" as const }
        ] }]
      : []),
    {
      label: copy.fileMenu,
      submenu: [platform === "darwin" ? { role: "close" } : { role: "quit" }]
    },
    {
      label: copy.editMenu,
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }
      ]
    },
    {
      label: copy.viewMenu,
      submenu: [
        // 不用 reload/zoom role（理由见 shared/view-menu.ts）：自定义项经 ViewManager 执行。
        ...VIEW_MENU_ITEMS.map((item): MenuItemConstructorOptions => item
          ? { id: `view:${item.action}`, label: copy[item.labelKey], accelerator: item.accelerator, click: () => onViewAction(item.action) }
          : { type: "separator" }),
        { type: "separator" },
        {
          label: copy.densityMenu,
          submenu: [
            {
              label: copy.compactDensity,
              type: "radio",
              checked: display.density === "compact",
              click: () => {
                onDisplay({ ...display, density: "compact" });
              }
            },
            {
              label: copy.comfortableDensity,
              type: "radio",
              checked: display.density === "comfortable",
              click: () => {
                onDisplay({ ...display, density: "comfortable" });
              }
            }
          ]
        },
        {
          label: copy.siteScaleMenu,
          submenu: [
            {
              label: copy.fitSiteScale,
              type: "radio",
              checked: display.siteScale === 0.9,
              click: () => {
                onDisplay({ ...display, siteScale: 0.9 });
              }
            },
            {
              label: copy.actualSiteScale,
              type: "radio",
              checked: display.siteScale === 1,
              click: () => {
                onDisplay({ ...display, siteScale: 1 });
              }
            }
          ]
        },
        { type: "separator" },
        ...resolveCommands(mode).filter((command) => !!commandAccelerator(command.id, platform, mode) && !(platform === "darwin" && command.id === "open-settings"))
          .map((command): MenuItemConstructorOptions => ({
            id: command.id,
            label: copy[command.labelKey],
            accelerator: commandAccelerator(command.id, platform, mode),
            // before-input-event owns these keys; prevent a second native dispatch on Win/Linux.
            ...(platform !== 'darwin' ? { registerAccelerator: false } : {}),
            click: () => dispatch(command.id)
          })),
        { type: "separator" }, { role: "togglefullscreen" }
      ]
    },
    { label: copy.windowMenu, submenu: platform === "darwin"
      ? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }, { role: "window" }]
      : [{ role: "minimize" }, { role: "close" }] }
  ];
}
