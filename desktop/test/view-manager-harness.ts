import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

// 真实 ViewManager 跑在桩 Electron 视图上（同 reload-commit.test.ts 的做法），供导航/菜单/外壳回归共用。
// 不以 .test.ts 命名：tsx --test 不会把它当用例文件重复注册。
export interface FakeSiteContents extends EventEmitter {
  readonly id: number;
  readonly calls: string[];
  url: string;
  history: { active: number; entries: string[] };
  mainFrame?: { url?: string; origin?: string };
  [key: string]: any;
}

export function viewManagerHarness({ sites = ["claude", "chatgpt"], committed = true } = {}) {
  const require = createRequire(resolve(__dirname, "../src/main/view-manager.ts"));
  const views: FakeSiteContents[] = [];
  const bounds: Array<{ id: number; width: number; height: number }> = [];
  let nextId = 1;
  let shellZoom = 0;
  const shell = Object.assign(new EventEmitter(), {
    id: 999, isDestroyed: () => false, focus() {},
    getZoomLevel: () => shellZoom, setZoomLevel: (level: number) => { shellZoom = level; },
    getZoomFactor: () => Math.pow(1.2, shellZoom)
  });
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => false, getContentSize: () => [2560, 1378],
    getNormalBounds: () => ({ x: 0, y: 0, width: 2560, height: 1378 }), isMaximized: () => false,
    contentView: { children: [] as unknown[], addChildView() {}, removeChildView() {} },
    webContents: shell
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/view-manager.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "electron") return { session: { fromPartition: () => ({ setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, clearStorageData: async () => {} }) } };
      if (name === "./site-view") return { createSiteView: (_site: unknown, callbacks: Record<string, (...args: any[]) => void>) => {
        const id = nextId++;
        const calls: string[] = [];
        let zoom = 1;
        const webContents: FakeSiteContents = Object.assign(new EventEmitter(), { id, calls, callbacks,
          url: "https://claude.ai/new",
          history: { active: 1, entries: ["https://claude.ai/chat/a", "https://claude.ai/new"] },
          isDestroyed: () => false, close() {}, loadURL: async () => {}, focus() {},
          getURL: () => webContents.url,
          reload: () => calls.push("reload"), reloadIgnoringCache: () => calls.push("reloadIgnoringCache"),
          stop: () => calls.push("stop"), send: () => calls.push("send"),
          navigationHistory: {
            canGoBack: () => webContents.history.active > 0,
            canGoForward: () => webContents.history.active < webContents.history.entries.length - 1,
            getActiveIndex: () => webContents.history.active,
            getEntryAtIndex: (index: number) => {
              const url = webContents.history.entries[index];
              return url === undefined ? null : { url, title: "" };
            },
            goBack: () => calls.push("goBack"), goForward: () => calls.push("goForward")
          },
          setZoomMode() {}, getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; calls.push(`zoom:${value}`); }
        });
        views.push(webContents);
        return { setVisible() {}, setBounds: (value: { width: number; height: number }) => bounds.push({ id, ...value }), webContents };
      } };
      return require(name);
    }
  });
  const manager = new module.exports.ViewManager(window, () => {}, () => {}, undefined, { selectedSites: sites });
  const status = (site: string) => manager.getStatuses().find((item: { site: string }) => item.site === site);
  if (committed) for (const view of views) view.emit("did-navigate", {}, view.getURL(), 200, "OK");
  return { manager, window, shell, views, status, bounds };
}
