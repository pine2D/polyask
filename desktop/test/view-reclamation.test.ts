import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { readSource } from "./fixtures";
import type { DesktopUiState } from "../src/shared/desktop-ui-state";

function harness(initialUiState?: DesktopUiState, clearStorageData: () => Promise<void> = async () => {}) {
  const require = createRequire(resolve(__dirname, "../src/main/view-manager.ts"));
  const bounds: any[] = [];
  const layouts: any[] = [];
  const contents: any[] = [], saved: DesktopUiState[] = [], reloads: number[] = [];
  const closed = new Set<number>(), attached = new Set<any>();
  const visibility = new Map<number, boolean>();
  let minimized = false;
  let size = [2560, 1378];
  let nextId = 1;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => minimized,
    getContentSize: () => size,
    getNormalBounds: () => ({ x: 0, y: 0, width: size[0], height: size[1] }), isMaximized: () => false,
    contentView: { addChildView(view: any) { attached.add(view); }, removeChildView(view: any) { attached.delete(view); } },
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 1 })
  });
  const module = { exports: {} as any };
  runInNewContext(transformSync(readSource("src/main/view-manager.ts"), { loader: "ts", format: "cjs" }).code, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === "electron") return { session: { fromPartition: () => ({ setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, clearStorageData }) } };
      if (name === "./site-view") return { createSiteView: () => {
        const id = nextId++;
        let zoom = 1;
        const view = {
          setVisible: (value: boolean) => visibility.set(id, value),
          setBounds: (value: unknown) => bounds.push({ id, value }),
          webContents: Object.assign(new EventEmitter(), { id,
            isDestroyed: () => closed.has(id), close: () => { closed.add(id); }, loadURL: async () => {}, focus() {},
            reloadIgnoringCache: () => { reloads.push(id); },
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
  return { manager, window, bounds, layouts, contents, saved, attached, visibility, reloads,
    setGeometry: (hidden: boolean, width: number, height: number) => { minimized = hidden; size = [width, height]; }
  };
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test("site data clear does not reload a page that started generating during the await", async () => {
  let finishClear!: () => void;
  const h = harness(undefined, () => new Promise<void>(resolve => { finishClear = resolve; }));
  try {
    h.manager.markStatus({ site: "claude", phase: "ready" });
    const clearing = h.manager.clearSiteData("claude");
    h.manager.markStatus({ site: "claude", phase: "generating" });
    finishClear();
    assert.equal(await clearing, false);
    assert.deepEqual(h.reloads, []);
    assert.equal(h.manager.getStatuses().find((s: { site: string }) => s.site === "claude").phase, "generating");
  } finally { h.window.emit("closed"); }
});

test("deselected generation is reclaimed on completion without another selection", async () => {
  const h = harness();
  try {
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    await turn();
    assert.equal(h.contents[0].isDestroyed(), false);
    h.manager.markStatus({ site: "claude", phase: "complete" });
    await turn();
    assert.equal(h.contents[0].isDestroyed(), true);
    assert.equal(h.manager.views.size, 2);
  } finally { h.window.emit("closed"); }
});

test("completion and further selection changes cannot outrun answer saving", async () => {
  const h = harness();
  let pending = true;
  try {
    h.manager.setCapturePending((site: string) => site === "claude" && pending);
    h.manager.markStatus({ site: "claude", phase: "complete" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    await turn();
    assert.equal(h.contents[0].isDestroyed(), false);
    pending = false;
    h.manager.releaseUnselectedViews();
    assert.equal(h.contents[0].isDestroyed(), true);
  } finally { h.window.emit("closed"); }
});

test("queued reclamation rechecks re-selection and a new send", async () => {
  for (const action of ["reselect", "send"]) {
    const h = harness();
    try {
      h.manager.markStatus({ site: "claude", phase: "generating" });
      h.manager.setSelection(["chatgpt", "gemini"]);
      h.manager.markStatus({ site: "claude", phase: "complete" });
      if (action === "reselect") h.manager.setSelection(["claude", "chatgpt", "gemini"]);
      else h.manager.markStatus({ site: "claude", phase: "sending" });
      await turn();
      assert.equal(h.contents[0].isDestroyed(), false);
    } finally { h.window.emit("closed"); }
  }
});

test("submitted and warning states remain retained while answer capture is pending", () => {
  for (const phase of ["submitted", "warning"]) {
    const h = harness();
    try {
      h.manager.setCapturePending((site: string) => site === "claude");
      h.manager.markStatus({ site: "claude", phase });
      h.manager.setSelection([]);
      assert.equal(h.contents[0].isDestroyed(), false);
    } finally { h.window.emit("closed"); }
  }
});

test("warning without completion evidence remains available for an uncertain submission", () => {
  const h = harness();
  try {
    h.manager.markStatus({ site: "claude", phase: "warning" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    assert.equal(h.contents[0].isDestroyed(), false);
  } finally { h.window.emit("closed"); }
});

test("exhausted generation monitoring releases a deselected page after capture ends", () => {
  const h = harness();
  let capturing = true;
  try {
    h.manager.setCapturePending((site: string) => site === "claude" && capturing, (site: string) => site === "claude");
    h.manager.beginGenerationRun("first", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "submitted" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    h.manager.generationMisses.set("claude", 4);
    h.manager.generationDeadlines.set("claude", Date.now() + 60_000);
    h.manager.scheduleGenerationProbe("first", "claude", false);
    assert.equal(h.contents[0].isDestroyed(), false, "answer capture still owns the page");
    capturing = false;
    h.manager.releaseUnselectedViews();
    assert.equal(h.contents[0].isDestroyed(), true);
  } finally { h.window.emit("closed"); }
});

test("generation deadline exhaustion also releases a deselected page", async () => {
  const h = harness();
  try {
    h.manager.setCapturePending(() => false, (site: string) => site === "claude");
    h.manager.beginGenerationRun("first", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    h.manager.generationDeadlines.set("claude", Date.now() - 1);
    h.manager.scheduleGenerationProbe("first", "claude", true);
    await turn();
    assert.equal(h.contents[0].isDestroyed(), true);
  } finally { h.window.emit("closed"); }
});

test("unknown generation after observation and capture budgets remains open", () => {
  const h = harness();
  try {
    h.manager.setCapturePending(() => false, () => false);
    h.manager.beginGenerationRun("first", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    h.manager.generationDeadlines.set("claude", Date.now() - 1);
    h.manager.scheduleGenerationProbe("first", "claude", true);
    assert.equal(h.contents[0].isDestroyed(), false);
    const status = h.manager.getStatuses().find((s: { site: string }) => s.site === "claude");
    assert.equal(status.phase, "warning");
    assert.equal(status.code, "generation_unconfirmed");
  } finally { h.window.emit("closed"); }
});

test("a new generation invalidates completion evidence from the previous run", () => {
  const h = harness();
  let ready = true;
  try {
    h.manager.setCapturePending(() => false, () => ready, () => { ready = false; });
    h.manager.beginGenerationRun("new", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    h.manager.generationDeadlines.set("claude", Date.now() - 1);
    h.manager.scheduleGenerationProbe("new", "claude", true);
    assert.equal(h.contents[0].isDestroyed(), false);
  } finally { h.window.emit("closed"); }
});

test("local reset clears stale generation status and releases deselected pages", () => {
  const h = harness();
  try {
    h.manager.beginGenerationRun("old", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection(["chatgpt", "gemini"]);
    h.manager.resetRunStatus();
    assert.equal(h.manager.generation.accepts("old", "claude"), false);
    assert.notEqual(h.manager.getStatuses().find((s: { site: string }) => s.site === "claude").phase, "generating");
    assert.equal(h.contents[0].isDestroyed(), true);
  } finally { h.window.emit("closed"); }
});

test("deselected busy pages remain attached and hidden so capture retains its viewport", async () => {
  const h = harness();
  try {
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.setSelection([]);
    await turn();
    assert.equal(h.attached.size, 1);
    assert.equal(h.visibility.get(1), false);
    assert.ok(h.bounds.filter(b => b.id === 1).at(-1).value.height > 0);
    h.manager.setSelection(["claude"]);
    assert.equal(h.visibility.get(1), true);
    assert.equal(h.contents.length, 3, "reselecting the retained page must not reload it");
  } finally { h.window.emit("closed"); }
});

test("a new site run preserves the deselected site's timer until capture and generation finish", async () => {
  const h = harness();
  let capturing = true;
  const timer = setTimeout(() => {}, 60_000);
  try {
    h.manager.setCapturePending((site: string) => site === "claude" && capturing);
    h.manager.beginGenerationRun("first", ["claude"]);
    h.manager.markStatus({ site: "claude", phase: "generating" });
    h.manager.generation.accept("first", "claude", "generating");
    h.manager.generationTimers.set("claude", timer);
    h.manager.setSelection(["chatgpt"]);
    h.manager.beginGenerationRun("second", ["chatgpt"]);
    assert.equal(h.manager.generationTimers.get("claude"), timer);
    for (let i = 0; i < 3; i++) {
      const phase = h.manager.generation.accept("first", "claude", "complete");
      if (phase === "complete") h.manager.markStatus({ site: "claude", phase });
    }
    await turn();
    assert.equal(h.contents[0].isDestroyed(), false);
    capturing = false;
    h.manager.releaseUnselectedViews();
    assert.equal(h.contents[0].isDestroyed(), true);
  } finally { clearTimeout(timer); h.window.emit("closed"); }
});
