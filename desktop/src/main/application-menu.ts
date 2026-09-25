import type { MenuItemConstructorOptions } from "electron";
import { COMMANDS, commandAccelerator, type CommandId } from "../shared/commands";
import type { DesktopCopy } from "../shared/copy";
import type { DisplayPreferences } from "../shared/display";

export function applicationMenu(
  platform: NodeJS.Platform, copy: DesktopCopy, display: DisplayPreferences,
  onDisplay: (value: DisplayPreferences) => void, dispatch: (id: CommandId) => void, appName: string
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
        { role: "reload" }, { role: "forceReload" }, { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
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
        ...COMMANDS.filter((command) => !!commandAccelerator(command.id, platform) && !(platform === "darwin" && command.id === "open-settings"))
          .map((command): MenuItemConstructorOptions => ({
            label: copy[command.labelKey],
            accelerator: commandAccelerator(command.id, platform),
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
