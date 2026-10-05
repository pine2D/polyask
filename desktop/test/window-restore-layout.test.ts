import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import type { DesktopUiState } from "../src/shared/desktop-ui-state";

function harness(initialUiState?: DesktopUiState) {
  const require = createRequire(resolve(__dirname, "../src/main/view-manager.ts"));
  const bounds: any[] = [];
  const layouts: any[] = [];
  const contents: any[] = [], saved: DesktopUiState[] = [];
  let minimized = false;
  let size = [2560, 1378];
  let nextId = 1;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => minimized,
    getContentSize: () => size,
    getNormalBounds: () => ({ x: 0, y: 0, width: size[0], height: size[1] }), isMaximized: () => false,
    contentView: { addChildView() {}, removeChildView() {} },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1 })
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/view-manager.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "electron") return { session: { fromPartition: () => ({ setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }) } };
      if (name === "./site-view") return { createSiteView: () => {
        const id = nextId++;
        let zoom = 1;
        const view = {
          setVisible() {},
          setBounds: (value: unknown) => bounds.push({ id, value }),
          webContents: Object.assign(new EventEmitter(), { id,
            isDestroyed: () => false, loadURL: async () => {}, focus() {},
            setZoomMode: (mode: string) => assert.equal(mode, "isolated"),
            getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; }
          })
        };
        contents.push(view.webContents);
        return view;
      } };
      return require(name);
    }
  });
  const manager = new module.exports.ViewManager(window, () => {}, (layout: unknown) => layouts.push(layout), undefined,
    { selectedSites: ["claude", "chatgpt", "gemini"], initialUiState, onUiStateChange: (state: DesktopUiState) => saved.push(state) });
  // First loads run under the commit cap (SiteHistoryAccess.initialLoad); start from pages whose first load committed.
  for (const page of contents) page.emit("did-navigate", {}, "https://example.invalid/", 200, "OK");
  return { manager, window, bounds, layouts, contents, saved,
    setGeometry: (hidden: boolean, width: number, height: number) => { minimized = hidden; size = [width, height]; }
  };
}

test("view manager restores per-site zoom and publishes edits in its persisted UI state", () => {
  const h = harness({ maximized: false, layoutMode: "overview", currentPage: 0,
    focusedByPage: { 0: "claude" }, siteZoom: { claude: 1.25, kimi: 0.75 } });
  assert.equal(h.contents[0].getZoomFactor(), 1.25);
  assert.equal(h.contents[1].getZoomFactor(), 0.9);
  h.contents[0].emit("zoom-changed", {}, "in");
  assert.equal(h.saved.at(-1)?.siteZoom?.claude, 1.5);
  assert.equal(h.saved.at(-1)?.siteZoom?.kimi, 0.75, "unselected site memory must survive a save");
  h.manager.setDrawerOpen(true);
  h.manager.setLayout("focus", "claude");
  assert.equal(h.contents[0].getZoomFactor(), 1.5);
  const restarted = harness(JSON.parse(JSON.stringify(h.saved.at(-1))));
  assert.equal(restarted.contents[0].getZoomFactor(), 1.5);
  h.manager.siteZoom.clear();
  assert.equal(Object.keys(h.saved.at(-1)?.siteZoom ?? {}).length, 0);
});

test("Windows maximized minimize resize preserves page bounds and overview mode", () => {
  const h = harness();
  const count = h.bounds.length;
  const notifications = h.layouts.length;
  h.setGeometry(true, 0, 0);
  h.window.emit("resize");
  assert.equal(h.bounds.length, count, "must not shrink live pages to 1px while minimized");
  assert.equal(h.layouts.length, notifications, "must not announce automatic focus");
  assert.equal(h.manager.getLayout().mode, "overview");
});

test("zero-size transition is ignored even before the minimized flag updates", () => {
  const h = harness();
  const count = h.bounds.length;
  for (const [width, height] of [[0, 0], [0, 1378], [2560, 0]]) {
    h.setGeometry(false, width, height);
    h.window.emit("resize");
  }
  assert.equal(h.bounds.length, count);
});

test("restore reapplies deferred layout changes even without a resize event", () => {
  const h = harness();
  const count = h.bounds.length;
  const originalHeight = h.bounds[0].value.height;
  h.setGeometry(true, 2560, 1378);
  h.manager.setComposerExpanded(true);
  assert.equal(h.bounds.length, count);
  h.setGeometry(false, 2560, 1378);
  h.window.emit("restore");
  assert.equal(h.bounds.length, count + 3);
  assert.ok(h.bounds.at(-1).value.height < originalHeight);
  assert.equal(h.manager.getLayout().mode, "overview");
});

test("a genuinely small visible window still automatically switches to focus", () => {
  const h = harness();
  h.setGeometry(false, 960, 680);
  h.window.emit("resize");
  assert.equal(h.manager.getLayout().mode, "focus");
  assert.equal(h.manager.getLayout().automaticFocus, true);
});
