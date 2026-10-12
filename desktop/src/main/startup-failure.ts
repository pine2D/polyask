import { app, dialog } from "electron";

import { getCopy } from "../shared/copy";
import type { DesktopDistribution } from "../shared/runtime";

/**
 * 启动失败的终局：弹本地化错误框后退出。从 main/index.ts 原样迁出（给代理启动接线腾行数，spec §3.3）。
 * 弹框本身失败也必须退出——finally 里的 app.quit() 不能被任何异常跳过。
 */
export function showStartupFailure(error: unknown, distribution: DesktopDistribution): void {
  try {
    try {
      console.error("PolyAsk startup failed", error);
    } catch {
      // Continue to the visible failure path if diagnostic output is unavailable.
    }
    const copy = getCopy(app.getLocale());
    const code = (error as { message?: string }).message;
    const systemCode = (error as NodeJS.ErrnoException).code;
    const portableStorageFailed = distribution === "portable"
      && ["EACCES", "EPERM", "EROFS", "EIO"].includes(systemCode ?? "");
    const failure = code === "portable_import_failed"
      ? [copy.portableImportFailedTitle, copy.portableImportFailedMessage]
      : code === "portable_data_unrecognized"
        ? [copy.portableDataConflictTitle, copy.portableDataConflictMessage]
        : portableStorageFailed
          ? [copy.portableStorageFailedTitle, copy.portableStorageFailedMessage]
          : [copy.startupFailedTitle, copy.startupFailedMessage];
    dialog.showErrorBox(
      failure[0],
      failure[1]
    );
  } finally {
    app.quit();
  }
}
