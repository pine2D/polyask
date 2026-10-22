import { contextBridge } from "electron";

// Badging 不受通知权限控制；在主世界替换，兼容未先做能力检测的站点。
// 同一脚本用于页面/子帧与 Service Worker，不暴露 Node 或 IPC 能力。
contextBridge.executeInMainWorld({ func: () => {
  const prototype = Object.getPrototypeOf(navigator);
  for (const key of ["setAppBadge", "clearAppBadge"]) {
    if (typeof prototype[key] !== "function") continue;
    Object.defineProperty(prototype, key, {
      value: async () => undefined,
      writable: false,
      configurable: false
    });
  }
} });
