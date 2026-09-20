import type { DesktopSurface } from "../shared/protocol";

export interface PendingSessionConfirmation {
  readonly count: number;
  readonly decide: (approved: boolean) => void;
}

export function confirmNewSession(
  count: number,
  show: (pending: PendingSessionConfirmation | null) => void,
  changeSurface: (surface: DesktopSurface) => void
): Promise<boolean> {
  // CSS 层级盖不住原生 WebContentsView；先让站点退出视图树，再显示外壳确认框。
  changeSurface("confirmation");
  return new Promise((resolve) => {
    let settled = false;
    show({ count, decide: (approved) => {
      if (settled) return;
      settled = true;
      show(null);
      // 在调用方开始导航前恢复站点视图，取消也必须回到原来的页面。
      changeSurface("sites");
      resolve(approved);
    } });
  });
}
