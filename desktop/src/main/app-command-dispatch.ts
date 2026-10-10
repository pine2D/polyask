import type { BrowserWindow } from "electron";
import type { CommandId } from "../shared/commands";
import type { ViewManager } from "./view-manager";

const HISTORY_COMMANDS: Readonly<Record<string, -1 | 1>> = {
  "site-back": -1,
  "site-forward": 1
};
const RELATIVE_COMMANDS: Readonly<Record<string, (manager: ViewManager) => void>> = {
  "next-page": manager => manager.pageRelative(1),
  "previous-page": manager => manager.pageRelative(-1),
  "next-site": manager => manager.focusRelative(1),
  "previous-site": manager => manager.focusRelative(-1)
};

/** Menus and native accelerators bypass the renderer, so they share its confirmation boundary. */
export function dispatchAppCommand(id: CommandId, manager: ViewManager | null, window: BrowserWindow | null): void {
  if (manager?.isConfirmationActive()) return;
  const page = (["show-page-1", "show-page-2", "show-page-3"] as const).indexOf(
    id as "show-page-1" | "show-page-2" | "show-page-3"
  );
  if (page >= 0) {
    manager?.pageDirect(page);
    return;
  }
  // 后退/前进作用于**当前聚焦的**站点视图：站内导航之后此前完全没有退路。
  const offset = HISTORY_COMMANDS[id];
  if (offset) {
    if (manager) manager.navigateHistory(manager.getLayout().focused, offset);
    return;
  }
  // 翻页/换焦点只有主进程的 ViewManager 知道当前页与聚焦顺序，渲染层重算会漂。
  const relative = RELATIVE_COMMANDS[id];
  if (relative) {
    if (manager) relative(manager);
    return;
  }
  if (!window || window.isDestroyed()) return;
  if (id === "focus-prompt") window.webContents.focus();
  window.webContents.send("polyask:command", id);
}
