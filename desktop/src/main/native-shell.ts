import { app, Menu, nativeTheme, type BrowserWindow } from "electron";
import { resolveLocale } from "../shared/locale";
import { shortcutLabel } from "../shared/shortcut-label";
import { bindShellTheme, shellBackground, shellContextMenu } from "./native-shell-policy";
import { showPlatinumPopupMenu, type PlatinumPopupEntry } from "./platinum-popup-menu";

type EditRole = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

const EDIT_LABELS: Record<"en" | "zhCN" | "zhTW", Record<EditRole, string>> = {
  en: { undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All" },
  zhCN: { undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" },
  zhTW: { undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選" }
};

const EDIT_ACCELS: Record<EditRole, string> = {
  undo: "CmdOrCtrl+Z",
  redo: process.platform === "win32" ? "Ctrl+Y" : "CmdOrCtrl+Shift+Z",
  cut: "CmdOrCtrl+X",
  copy: "CmdOrCtrl+C",
  paste: "CmdOrCtrl+V",
  selectAll: "CmdOrCtrl+A"
};

function resolveRoleLabel(role: EditRole): string {
  const menuItems = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? [];
  const match = menuItems.find((item) => item.role?.toLowerCase() === role.toLowerCase());
  const cleaned = match?.label?.replace(/&([A-Za-z])/g, "$1").replace(/\(&[A-Za-z]\)/g, "").trim();
  if (cleaned) return cleaned;
  return EDIT_LABELS[resolveLocale(app.getLocale())][role];
}

export const initialShellBackground = (): string => shellBackground(nativeTheme);

export function installNativeShell(window: BrowserWindow): void {
  bindShellTheme(window, nativeTheme);
  // 只接管本地外壳，远程 AI 站点的右键行为仍归站点所有。
  window.webContents.on("context-menu", (_event, params) => {
    const rawItems = shellContextMenu(params);
    if (!rawItems.length) return;
    const isMac = process.platform === "darwin";
    const entries: PlatinumPopupEntry<EditRole>[] = rawItems.map((item) => {
      if (item.type === "separator") return { type: "separator" };
      const role = item.role as EditRole;
      return {
        id: role,
        label: resolveRoleLabel(role),
        enabled: item.enabled !== false,
        accelerator: shortcutLabel(EDIT_ACCELS[role], isMac)
      };
    });
    const zoom = window.webContents.getZoomFactor() || 1;
    void showPlatinumPopupMenu(window, entries, { x: params.x / zoom, y: params.y / zoom, width: 0, height: 0, align: "start" }).then((picked) => {
      if (!picked || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents[picked]();
    });
  });
}
