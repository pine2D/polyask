import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

import { getCopy } from "../src/shared/copy";
import { DEFAULT_DISPLAY_PREFERENCES } from "../src/shared/display";
import { readSource } from "./fixtures";

function loadMainWindowModule(options: {
  readonly platform?: NodeJS.Platform;
  readonly sessionType?: string;
  readonly rawUiState?: unknown;
  readonly workAreas?: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
}) {
  const realRequire = createRequire(resolve(__dirname, "../src/main/main-window.ts"));
  const createdWindows: Array<{
    options: Record<string, unknown>;
    autoHide: boolean[];
    menuVisible: boolean[];
    shown: number;
    maximized: number;
    emitter: EventEmitter;
    contents: EventEmitter & { openHandler: (() => { action: string }) | null };
  }> = [];
  const scheduled: unknown[] = [];
  const saved: unknown[] = [];
  const nativeInstalled: unknown[] = [];
  const committedMenus: unknown[][] = [];

  class FakeBrowserWindow extends EventEmitter {
    readonly webContents = Object.assign(new EventEmitter(), {
      openHandler: null as (() => { action: string }) | null,
      setWindowOpenHandler(handler: () => { action: string }) {
        this.openHandler = handler;
      }
    });
    readonly autoHide: boolean[] = [];
    readonly menuVisible: boolean[] = [];
    shown = 0;
    maximized = 0;
    constructor(windowOptions: Record<string, unknown>) {
      super();
      createdWindows.push({
        options: windowOptions,
        autoHide: this.autoHide,
        menuVisible: this.menuVisible,
        shown: 0,
        maximized: 0,
        emitter: this,
        contents: this.webContents
      });
    }
    setAutoHideMenuBar(value: boolean) { this.autoHide.push(value); }
    setMenuBarVisibility(value: boolean) { this.menuVisible.push(value); }
    maximize() { createdWindows[createdWindows.length - 1]!.maximized += 1; }
    show() { createdWindows[createdWindows.length - 1]!.shown += 1; }
  }

  class FakeUiStateStore {
    readonly path: string;
    constructor(filePath: string) { this.path = filePath; }
    load() { return options.rawUiState ?? null; }
    schedule(state: unknown) { scheduled.push(state); }
    save(state: unknown) { saved.push(state); }
  }

  const moduleHolder = { exports: {} as Record<string, unknown> };
  const compiled = transformSync(readSource("src/main/main-window.ts"), {
    loader: "ts",
    format: "cjs"
  }).code;
  const mockProcess = {
    platform: options.platform ?? "linux",
    env: options.sessionType ? { XDG_SESSION_TYPE: options.sessionType } : {}
  };
  runInNewContext(compiled, {
    exports: moduleHolder.exports,
    module: moduleHolder,
    process: mockProcess,
    require: (specifier: string) => {
      if (specifier === "electron") {
        return {
          app: {
            isPackaged: false,
            getAppPath: () => resolve(__dirname, "..")
          },
          BrowserWindow: FakeBrowserWindow,
          screen: {
            getAllDisplays: () => (options.workAreas ?? [{ x: 0, y: 0, width: 1920, height: 1080 }])
              .map((workArea) => ({ workArea }))
          },
          webContents: { getFocusedWebContents: () => null }
        };
      }
      if (specifier === "./native-shell") {
        return {
          initialShellBackground: () => "#121316",
          installNativeShell: (win: unknown) => { nativeInstalled.push(win); }
        };
      }
      if (specifier === "./ui-state-store") {
        return { UiStateStore: FakeUiStateStore };
      }
      if (specifier === "./application-command-routing") {
        return {
          prepareApplicationMenu: (args: unknown[]) => ({
            args,
            commit: () => { committedMenus.push(args); }
          })
        };
      }
      if (specifier === "./view-menu-actions") {
        return { runViewMenuAction: () => undefined };
      }
      return realRequire(specifier);
    }
  });
  return {
    mod: moduleHolder.exports as typeof import("../src/main/main-window"),
    createdWindows,
    scheduled,
    saved,
    nativeInstalled,
    committedMenus
  };
}

test("createMainWindow hardens webPreferences, skips Wayland coordinates, and persists UI state lifecycle", () => {
  const copy = getCopy("zh-CN");
  const wayland = loadMainWindowModule({
    platform: "linux",
    sessionType: "wayland",
    rawUiState: {
      windowBounds: { x: 120, y: 80, width: 1440, height: 900 },
      maximized: true
    }
  });
  const created = wayland.mod.createMainWindow({
    userDataPath: "/tmp/polyask-profile",
    selectedSites: ["chatgpt", "claude"],
    copy,
    preview: true,
    preloadEntry: "file:///app/preload.js",
    shellEntry: "file:///app/index.html"
  });
  const winRecord = wayland.createdWindows[0]!;
  assert.equal(winRecord.options.x, undefined, "Wayland session skips x restore");
  assert.equal(winRecord.options.y, undefined, "Wayland session skips y restore");
  assert.equal(winRecord.options.width, 1440);
  assert.equal(winRecord.options.height, 900);
  assert.equal(winRecord.options.frame, false, "Platinum custom titlebar uses frameless window");
  assert.equal(winRecord.options.icon, resolve(__dirname, "../resources/icon.png"));
  assert.match(String(winRecord.options.title), /试玩/);
  assert.deepEqual(winRecord.autoHide, [true]);
  assert.deepEqual(winRecord.menuVisible, [false]);
  assert.equal(wayland.nativeInstalled.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(winRecord.options.webPreferences)), {
    preload: "file:///app/preload.js",
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true
  });

  let prevented = 0;
  winRecord.contents.emit("will-navigate", { preventDefault: () => { prevented += 1; } }, "https://evil.example/");
  assert.equal(prevented, 1, "untrusted shell navigation must be blocked");
  winRecord.contents.emit("will-navigate", { preventDefault: () => { prevented += 1; } }, "file:///app/index.html#settings");
  assert.equal(prevented, 1, "trusted shell entry navigation stays allowed");
  assert.equal(winRecord.contents.openHandler?.().action, "deny");

  created.bindUiStatePersistence(() => created.initialUiState);
  winRecord.emitter.emit("move");
  winRecord.emitter.emit("maximize");
  winRecord.emitter.emit("unmaximize");
  assert.equal(wayland.scheduled.length, 3);
  winRecord.emitter.emit("close");
  assert.equal(wayland.saved.length, 1);
  winRecord.emitter.emit("ready-to-show");
  assert.equal(winRecord.maximized, 1);
  assert.equal(winRecord.shown, 1);
});

test("createMainWindow restores window position on non-Wayland and omits menu auto-hide on macOS", () => {
  const copy = getCopy("en");
  const darwin = loadMainWindowModule({
    platform: "darwin",
    rawUiState: {
      windowBounds: { x: 100, y: 60, width: 1280, height: 800 },
      maximized: false
    }
  });
  darwin.mod.createMainWindow({
    userDataPath: "/tmp/polyask-mac",
    selectedSites: ["chatgpt"],
    copy,
    preview: false,
    preloadEntry: "file:///app/preload.js",
    shellEntry: "file:///app/index.html"
  });
  const winRecord = darwin.createdWindows[0]!;
  assert.equal(winRecord.options.x, 100);
  assert.equal(winRecord.options.y, 60);
  assert.equal(winRecord.options.icon, undefined, "macOS uses app bundle icns rather than BrowserWindow icon");
  assert.equal(winRecord.options.title, copy.appTitle);
  assert.deepEqual(winRecord.autoHide, []);
  assert.deepEqual(winRecord.menuVisible, []);

  const win32 = loadMainWindowModule({ platform: "win32" });
  win32.mod.createMainWindow({
    userDataPath: "/tmp/polyask-win",
    selectedSites: ["chatgpt"],
    copy,
    preview: false,
    preloadEntry: "file:///app/preload.js",
    shellEntry: "file:///app/index.html"
  });
  assert.equal(win32.createdWindows[0]!.options.icon, resolve(__dirname, "../resources/icon.ico"));
});

test("createApplicationMenuController routes display updates to PreferenceRuntime before manager fallback", () => {
  const harness = loadMainWindowModule({ platform: "win32" });
  let runtimeCalls = 0;
  let fallbackCalls = 0;
  let useRuntime = true;
  const fakeManager = {
    getDisplayPreferences: () => DEFAULT_DISPLAY_PREFERENCES
  } as never;
  const controller = harness.mod.createApplicationMenuController({
    getLocale: () => "zh-CN",
    getAppName: () => "PolyAsk",
    getMode: () => "standard",
    getManager: () => fakeManager,
    getMainWindow: () => null,
    getPreferences: () => (useRuntime ? ({ setDisplay: () => { runtimeCalls += 1; } } as never) : null),
    dispatchAppCommand: () => undefined,
    applyDisplayFallback: () => { fallbackCalls += 1; }
  });
  controller.createMenu();
  assert.equal(harness.committedMenus.length, 1);
  const onDisplay = harness.committedMenus[0]![3] as (value: typeof DEFAULT_DISPLAY_PREFERENCES) => void;
  onDisplay(DEFAULT_DISPLAY_PREFERENCES);
  assert.equal(runtimeCalls, 1);
  assert.equal(fallbackCalls, 0);
  useRuntime = false;
  onDisplay(DEFAULT_DISPLAY_PREFERENCES);
  assert.equal(fallbackCalls, 1);
});
