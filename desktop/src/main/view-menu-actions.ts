import type { SiteKey } from "../shared/contracts";
import type { SiteZoomAction } from "../shared/site-zoom";
import type { ViewMenuAction } from "../shared/view-menu";
import { changePageZoom, type PageZoomContents } from './page-zoom';

interface MenuContents {
  readonly id: number;
  isDestroyed(): boolean;
}

type ShellZoomContents = MenuContents & PageZoomContents;

export interface ViewMenuTarget {
  isConfirmationActive(): boolean;
  owns(contents: MenuContents): SiteKey | null;
  getLayout(): { readonly focused: SiteKey };
  reload(site: SiteKey, ignoreCache?: boolean): boolean;
  relayout(): void;
  readonly siteZoom: { step(site: SiteKey, action: SiteZoomAction): void };
}

/**
 * 「视图」菜单的重新加载与缩放（加速器见 shared/view-menu.ts）。焦点在站点视图 → 作用于该站；
 * 焦点在外壳 → 重新加载当前聚焦站点（外壳本身不再被 Ctrl+R 重载）、缩放外壳并按新缩放重排原生视图
 * （程序化改缩放不会发 zoom-changed，只有 Ctrl+滚轮会）。重新加载一律经 ViewManager.reload，
 * 服从发送/生成闸门、提交中导航保护与提交上限；确认框期间与其它菜单命令一样不导航。
 */
export function runViewMenuAction(action: ViewMenuAction, manager: ViewMenuTarget | null,
  shell: ShellZoomContents | null, focused: MenuContents | null): boolean {
  if (!manager) return false;
  const owner = focused && !focused.isDestroyed() ? manager.owns(focused) : null;
  if (action === "reload" || action === "force-reload") {
    if (manager.isConfirmationActive()) return false;
    return manager.reload(owner ?? manager.getLayout().focused, action === "force-reload");
  }
  const zoom = action.slice("zoom-".length) as SiteZoomAction;
  if (owner) {
    manager.siteZoom.step(owner, zoom);
    return true;
  }
  if (!shell || shell.isDestroyed()) return false;
  changePageZoom(shell, zoom, () => manager.relayout());
  return true;
}
