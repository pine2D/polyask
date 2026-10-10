import type { DesktopCopy } from "./copy";
import { SITE_ZOOM_SHORTCUTS, type SiteZoomAction } from "./site-zoom";

export type ViewMenuAction = "reload" | "force-reload" | `zoom-${SiteZoomAction}`;

export interface ViewMenuItem {
  readonly action: ViewMenuAction;
  readonly labelKey: keyof DesktopCopy;
  readonly accelerator: string;
}

const zoomAccelerator = (action: SiteZoomAction): string =>
  SITE_ZOOM_SHORTCUTS.find(item => item.action === action)!.accelerator;

// 「视图」菜单里原本是 Electron 的 reload/forceReload/zoom role 项：role 直接作用于获得焦点的 webContents，
// 站点视图聚焦时 Ctrl+R 绕过 ViewManager 的发送/生成闸门、提交中导航保护与 20s 提交上限；外壳聚焦时则重载外壳本身，
// 主进程的外壳镜像状态与新渲染层脱钩；外壳缩放也不触发原生视图重排。改为自定义项后加速器不再由 Electron 内部赋予，
// 统一登记在这里（与 role 默认值相同），菜单与快捷键速查（读真实菜单）同源。
export const VIEW_MENU_ITEMS: readonly (ViewMenuItem | null)[] = Object.freeze([
  { action: "reload", labelKey: "menuReloadSite", accelerator: "CmdOrCtrl+R" },
  { action: "force-reload", labelKey: "menuForceReloadSite", accelerator: "Shift+CmdOrCtrl+R" },
  null,
  { action: "zoom-reset", labelKey: "menuActualSize", accelerator: zoomAccelerator("reset") },
  { action: "zoom-in", labelKey: "menuZoomIn", accelerator: zoomAccelerator("in") },
  { action: "zoom-out", labelKey: "menuZoomOut", accelerator: zoomAccelerator("out") }
]);
