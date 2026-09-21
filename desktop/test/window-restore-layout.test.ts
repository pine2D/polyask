import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";

function harness() {
  const require = createRequire(resolve(__dirname, "../src/main/view-manager.ts"));
  const bounds: any[] = [];
  const layouts: any[] = [];
  let minimized = false;
  let size = [2560, 1378];
  let nextId = 1;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => minimized,
    getContentSize: () => size,
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
        return {
          setBounds: (value: unknown) => bounds.push({ id, value }),
          webContents: Object.assign(new EventEmitter(), { id,
            isDestroyed: () => false, loadURL: async () => {},
            getZoomFactor: () => zoom, setZoomFactor: (value: number) => { zoom = value; }
          })
        };
      } };
      return require(name);
    }
  });
  const manager = new module.exports.ViewManager(window, () => {}, (layout: unknown) => layouts.push(layout), undefined,
    { selectedSites: ["claude", "chatgpt", "gemini"] });
  return { manager, window, bounds, layouts,
    setGeometry: (hidden: boolean, width: number, height: number) => { minimized = hidden; size = [width, height]; }
  };
}

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
