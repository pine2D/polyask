import type { App } from "electron";

// 必须先于 session 创建：已缓存的 Service Worker 启动时也要加载，不能等页面 ready。
export function disableWebBadging(app: Pick<App, "on">, preloadPath: string): void {
  app.on("session-created", session => {
    session.registerPreloadScript({ type: "service-worker", filePath: preloadPath });
  });
}
