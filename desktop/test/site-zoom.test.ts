import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { WebContents } from "electron";
import { SiteZoomController } from "../src/main/site-zoom";
import { parseSiteZoom, siteZoomAction, stepSiteZoom } from "../src/shared/site-zoom";
import { parseDesktopUiState } from "../src/shared/desktop-ui-state";
import { applyWorkspaceLayout } from "../src/main/workspace-layout";
import { DEFAULT_DISPLAY_PREFERENCES, metricsForDensity } from "../src/shared/display";
import { readSource } from "./fixtures";

function contents() {
  let zoom = 0.9, mode = "default";
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getZoomFactor: () => zoom,
    getZoomMode: () => mode,
    setZoomMode: (value: string) => { mode = value; },
    setZoomFactor: (value: number) => { zoom = value; }
  });
}
const key = (key: string, overrides = {}) => ({ type: "keyDown", key, control: true, meta: false,
  alt: false, shift: false, isComposing: false, ...overrides });

test("site zoom keys support Ctrl, Mac Command, plus aliases and reset without stealing typing", () => {
  for (const value of ["+", "="]) assert.equal(siteZoomAction(key(value), "win32"), "in");
  assert.equal(siteZoomAction(key("-"), "linux"), "out");
  assert.equal(siteZoomAction(key("0"), "win32"), "reset");
  assert.equal(siteZoomAction(key("+", { control: false, meta: true }), "darwin"), "in");
  for (const overrides of [{ control: false }, { alt: true }, { isComposing: true }, { type: "keyUp" }]) {
    assert.equal(siteZoomAction(key("+", overrides), "win32"), null);
  }
});

test("two views on a shared login origin retain independent zoom across navigation", () => {
  let originZoom = 0.9;
  const peer = () => {
    const c = contents();
    let isolatedZoom = 0.9;
    c.getZoomFactor = () => c.getZoomMode() === "isolated" ? isolatedZoom : originZoom;
    c.setZoomFactor = value => { if (c.getZoomMode() === "isolated") isolatedZoom = value; else originZoom = value; };
    return c;
  };
  const first = peer(), second = peer();
  const controller = new SiteZoomController(() => {});
  controller.bind("claude", first as unknown as WebContents);
  controller.bind("kimi", second as unknown as WebContents);
  first.emit("zoom-changed", {}, "in");
  assert.equal(first.getZoomFactor(), 1);
  assert.equal(second.getZoomFactor(), 0.9, "shared login origin must not share site zoom");
  first.emit("did-finish-load"); second.emit("did-finish-load");
  assert.equal(first.getZoomFactor(), 1);
  assert.equal(second.getZoomFactor(), 1, "second site restores its own default");
  first.emit("zoom-changed", {}, "in");
  assert.equal(second.getZoomFactor(), 1);
  assert.equal(first.getZoomMode(), "isolated");
});

test("browser zoom steps stay bounded and tolerate Chromium floating-point factors", () => {
  assert.equal(stepSiteZoom(0.9, "in"), 1);
  assert.equal(stepSiteZoom(1.10000000001, "out"), 1);
  assert.equal(stepSiteZoom(1.24999999999, "in"), 1.5);
  assert.equal(stepSiteZoom(5, "in"), 5);
  assert.equal(stepSiteZoom(0.25, "out"), 0.25);
  assert.equal(stepSiteZoom(2, "reset"), 1);
});

test("only finite, in-range zoom factors for known sites survive UI-state restore", () => {
  const stored = { claude: 1.5, kimi: 0.75, unknown: 2, gemini: 0, doubao: 8, chatgpt: "2", yuanbao: NaN };
  assert.deepEqual(parseSiteZoom(stored), { claude: 1.5, kimi: 0.75 });
  assert.deepEqual(parseSiteZoom([]), {});
  assert.deepEqual(parseDesktopUiState({ siteZoom: stored }, [], ["claude"]).siteZoom, { claude: 1.5, kimi: 0.75 });
  const fixture = JSON.parse(readSource("test/fixtures/desktop-ui-site-zoom.json"));
  assert.deepEqual(parseDesktopUiState(fixture, [], ["claude"]).siteZoom, fixture.siteZoom);
});

test("wheel and keyboard zoom affect one site, survive layouts and restore in a new controller", () => {
  let saved = {};
  const controller = new SiteZoomController(() => { saved = controller.snapshot(); });
  const first = contents(), second = contents();
  const firstView = { webContents: first as unknown as WebContents, setBounds() {} };
  const secondView = { webContents: second as unknown as WebContents, setBounds() {} };
  controller.bind("claude", firstView.webContents);
  controller.bind("kimi", secondView.webContents);
  first.emit("zoom-changed", {}, "in");
  assert.equal(first.getZoomFactor(), 1);
  assert.equal(second.getZoomFactor(), 0.9);
  let prevented = false;
  first.emit("before-input-event", { preventDefault: () => { prevented = true; } }, key("+"));
  assert.equal(prevented, true);
  assert.equal(first.getZoomFactor(), 1.1);
  const layout = { views: new Map([["claude", firstView], ["kimi", secondView]]) as any,
    placements: [{ key: "claude" as const, bounds: { x: 0, y: 0, width: 600, height: 500 } }],
    metrics: metricsForDensity("compact"), zoom: 1, display: DEFAULT_DISPLAY_PREFERENCES,
    mode: "focus" as const, focused: "claude" as const, siteZoom: controller };
  applyWorkspaceLayout(layout);
  assert.equal(first.getZoomFactor(), 1.1, "layout must not overwrite manual zoom");
  const restored = new SiteZoomController(() => {});
  restored.restore(JSON.parse(JSON.stringify(saved)));
  const replacement = contents();
  restored.bind("claude", replacement as unknown as WebContents);
  restored.apply("claude", replacement as unknown as WebContents, 0.9);
  assert.equal(replacement.getZoomFactor(), 1.1);
  first.emit("before-input-event", { preventDefault() {} }, key("0"));
  assert.equal(first.getZoomFactor(), 1);
  controller.clear();
  applyWorkspaceLayout({ ...layout, mode: "overview" });
  assert.equal(first.getZoomFactor(), 0.9);
  assert.deepEqual(saved, {});
});
