import { dispatchAppCommand as dispatchShellCommand } from './app-command-dispatch';
import { applicationMenu } from "./application-menu";
import { installNativeShell, initialShellBackground } from "./native-shell";
import { createWindowDataServices } from './window-data-services';
import type { PreferenceRuntime } from './preference-runtime';
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  Notification,
  screen,
  shell as electronShell,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import {
  commandAliasForInput,
  type CommandId
} from "../shared/commands";
import { formatCopy, getCopy } from "../shared/copy";
import { parseDesktopUiState } from "../shared/desktop-ui-state";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type { RuntimeInfo } from "../shared/runtime";
import { BroadcastCoordinator } from "./broadcast";
import { CollectionService } from "./collection-service";
import { CompletionNotifier } from "./completion-notifier";
import { DesktopDatabase } from "./database";
import {
  applyPortableImportIdentity,
  finalizePortableDataImport,
  hasImportableLegacyData,
  initializePortableData,
  isPortableDataInitialized,
  resolveRuntimeProfile
} from "./portable-profile";
import { isTrustedShellUrl, safeExternalUrl } from "./security";
import { startRuntimeGates } from "./runtime-gates";
import { registerShellIpc } from "./shell-ipc";
import { SITES } from "./sites";
import { runStartup } from "./startup";
import { UiStateStore } from "./ui-state-store";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

// TODO(size-ratchet)：548 行，目标 ≤400——抽出 createServices（数据库、archives/history/promptLibrary/synthesis/sync/dataAdmin 装配）
// 与 createMainWindow（BrowserWindow、菜单、runtime gates），入口只留 app 生命周期。
if (squirrelStartup) app.quit();
const startupLocale = (): string => {
  try { return app.getPreferredSystemLanguages()[0] ?? "en"; }
  catch { return "en"; }
};
const runtimeProfile = resolveRuntimeProfile({
  isPackaged: app.isPackaged,
  execPath: process.execPath,
  defaultUserDataPath: app.getPath("userData"),
  version: app.getVersion()
});
const runtimeInfo: RuntimeInfo = {
  distribution: runtimeProfile.distribution,
  version: runtimeProfile.version
};
let profileReady = true;
let instanceLockHeld = false;
let legacyProfileLock = false;
let legacyDataAvailable = false;
if (runtimeProfile.distribution === "portable") {
  try {
    const portableDataInitialized = isPortableDataInitialized(runtimeProfile);
    if (!portableDataInitialized) legacyDataAvailable = hasImportableLegacyData(runtimeProfile);
    if (portableDataInitialized) {
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      instanceLockHeld = app.requestSingleInstanceLock();
      if (instanceLockHeld) finalizePortableDataImport(runtimeProfile);
    } else if (legacyDataAvailable) {
      legacyProfileLock = app.requestSingleInstanceLock();
      instanceLockHeld = legacyProfileLock;
      if (!legacyProfileLock) throw new Error("portable_legacy_in_use");
      finalizePortableDataImport(runtimeProfile);
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      if (isPortableDataInitialized(runtimeProfile)) {
        app.releaseSingleInstanceLock();
        legacyProfileLock = false;
        instanceLockHeld = app.requestSingleInstanceLock();
      }
    } else {
      mkdirSync(runtimeProfile.userDataPath, { recursive: true });
      app.setPath("userData", runtimeProfile.userDataPath);
      app.setPath("sessionData", runtimeProfile.userDataPath);
      instanceLockHeld = app.requestSingleInstanceLock();
      if (instanceLockHeld) finalizePortableDataImport(runtimeProfile);
    }
  } catch (error) {
    profileReady = false;
    const copy = getCopy(startupLocale());
    const code = (error as { message?: string }).message;
    const failure = code === "portable_import_failed"
      ? [copy.portableImportFailedTitle, copy.portableImportFailedMessage]
      : code === "portable_data_unrecognized"
        ? [copy.portableDataConflictTitle, copy.portableDataConflictMessage]
        : code === "portable_legacy_in_use"
          ? [copy.portableLegacyInUseTitle, copy.portableLegacyInUseMessage]
          : [copy.portableStorageFailedTitle, copy.portableStorageFailedMessage];
    dialog.showErrorBox(failure[0], failure[1]);
    app.quit();
  }
}
if (process.platform === "win32") {
  app.setAppUserModelId(runtimeProfile.distribution === "portable"
    ? "com.pine2d.polyask.portable"
    : "com.squirrel.PolyAsk.PolyAsk");
}

const coordinator = new BroadcastCoordinator();
// Assisted synthesis owns a second coordinator: BroadcastCoordinator.send aborts
// whatever the same instance is still dispatching, so sharing one would let a
// synthesis prompt tear down an in-flight broadcast. polyask:cancel cancels both.
const synthesisCoordinator = new BroadcastCoordinator();
let mainWindow: BrowserWindow | null = null;
let viewManager: ViewManager | null = null;
let desktopDatabase: DesktopDatabase | null = null;
let preferenceRuntime: PreferenceRuntime | null = null;

if (app.isPackaged) app.commandLine.removeSwitch("remote-debugging-port");

function sendToShell(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function dispatchAppCommand(id: CommandId): void {
  dispatchShellCommand(id, viewManager, mainWindow);
}

function applyDisplayPreferences(
  manager: ViewManager,
  value: DisplayPreferences
): DisplayPreferences {
  manager.setDisplayPreferences(value);
  createMenu();
  sendToShell("polyask:display-preferences", value);
  return value;
}

function createMenu(): void {
  const copy = getCopy(app.getLocale());
  const display = viewManager?.getDisplayPreferences() ?? DEFAULT_DISPLAY_PREFERENCES;
  const template = applicationMenu(process.platform, copy, display,
    (value) => { if (preferenceRuntime) preferenceRuntime.setDisplay(value); else if (viewManager) applyDisplayPreferences(viewManager, value); }, dispatchAppCommand, app.name);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const copy = getCopy(app.getLocale());
  if (!desktopDatabase) throw new Error("database_not_ready");
  const database = desktopDatabase;
  let managerForWorkspace: ViewManager | null = null;
  let collectionForWorkspace: CollectionService | null = null;
  const workspace = new WorkspaceService(
    database.state,
    database.meta,
    (site, url) => {
      if (!managerForWorkspace) throw new Error("view_manager_not_ready");
      return managerForWorkspace.navigate(site, url, "commit");
    },
    {
      onNewSession: () => collectionForWorkspace?.clearRun(),
      context: (site) => managerForWorkspace?.historyAccess.context(site)?.id,
      abandon: (site, contentsId, target) => managerForWorkspace?.historyAccess.abandon(site, contentsId, target)
    }
  );
  const workspaceState = workspace.getState();
  const uiStateStore = new UiStateStore(join(app.getPath("userData"), "desktop-ui-state.json"));
  const initialUiState = parseDesktopUiState(
    uiStateStore.load(),
    screen.getAllDisplays().map((display) => display.workArea),
    workspaceState.selectedSites
  );
  const bounds = initialUiState.windowBounds;
  const restorePosition = !(process.platform === "linux"
    && process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland");
  const window = new BrowserWindow({
    title: copy.appTitle,
    width: bounds?.width ?? 1600,
    height: bounds?.height ?? 1050,
    ...(bounds && restorePosition ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: initialShellBackground(),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  if (process.platform !== "darwin") {
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  }
  installNativeShell(window);
  mainWindow = window;
  const completionNotifier = new CompletionNotifier({
    copy: {
      title: copy.appTitle,
      complete: (site) => formatCopy(copy.completionNotificationComplete, { site }),
      failed: (site) => formatCopy(copy.completionNotificationFailed, { site })
    },
    focused: () => window.isFocused(),
    show: (notification) => {
      if (Notification.isSupported()) new Notification({ ...notification, silent: true }).show();
    }
  });
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, MAIN_WINDOW_WEBPACK_ENTRY)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const runtimeGates = startRuntimeGates(window);
  const manager = new ViewManager(
    window,
    (status) => {
      sendToShell("polyask:site-status", status);
      const site = SITES.find((candidate) => candidate.key === status.site);
      completionNotifier.accept(status, site?.label ?? status.site);
    },
    (layout) => sendToShell("polyask:layout", layout),
    runtimeGates.record,
    {
      initialUiState,
      selectedSites: workspaceState.selectedSites,
      onUiStateChange: (state) => { uiStateStore.schedule(state); preferenceRuntime?.captureUi(state); },
      // 站点视图里点到的外部链接交给用户自己的浏览器。视图本身绝不导航过去——格子里永远是这个站。
      // 复用 safeExternalUrl 的校验（只放行 http/https、拒带凭据的 URL）。
      openExternal: (url) => {
        const safe = safeExternalUrl(url);
        if (safe) void electronShell.openExternal(safe);
      }
    }
  );
  managerForWorkspace = manager;
  viewManager = manager;
  const { archives, history, promptLibrary, decisions, folders, backup, questions, collection, preferences, synthesis, sync, dataAdmin } = await createWindowDataServices({
    database, manager, workspace, coordinator, synthesisCoordinator, publish: sendToShell,
    applyDisplay: value => applyDisplayPreferences(manager, value),
    setNotifications: enabled => completionNotifier.setEnabled(enabled)
  });
  preferenceRuntime = preferences;
  collectionForWorkspace = collection;
  createMenu();
  const disposeIpc = registerShellIpc({
    runtime: runtimeInfo,
    copy,
    window,
    manager,
    workspace,
    coordinator,
    synthesisCoordinator,
    collection, questions,
    archives,
    decisions, folders, backup,
    history,
    promptLibrary,
    synthesis,
    sync,
    dataAdmin, preferences,
    shellEntry: MAIN_WINDOW_WEBPACK_ENTRY,
    applyDisplay: (value) => preferences.setDisplay(value),
    setCompletionNotifications: (enabled) => { preferences.set('completionNotifications', enabled); }
  });
  window.on("move", () => uiStateStore.schedule(manager.getUiState()));
  window.on("maximize", () => uiStateStore.schedule(manager.getUiState()));
  window.on("unmaximize", () => uiStateStore.schedule(manager.getUiState()));
  window.on("close", () => uiStateStore.save(manager.getUiState()));
  window.once("ready-to-show", () => {
    if (initialUiState.maximized) window.maximize();
    window.show();
  });
  await window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  sync.start();
  runtimeGates.writeDiagnostic(manager);
  window.on("closed", () => {
    uiStateStore.dispose();
    runtimeGates.dispose();
    sync.dispose();
    disposeIpc();
    mainWindow = null;
    viewManager = null;
    preferenceRuntime = null;
  });
}

function failStartup(error: unknown): void {
  try {
    try {
      console.error("PolyAsk startup failed", error);
    } catch {
      // Continue to the visible failure path if diagnostic output is unavailable.
    }
    const copy = getCopy(app.getLocale());
    const code = (error as { message?: string }).message;
    const systemCode = (error as NodeJS.ErrnoException).code;
    const portableStorageFailed = runtimeProfile.distribution === "portable"
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

const gotLock = profileReady && (runtimeProfile.distribution === "portable"
  ? instanceLockHeld
  : app.requestSingleInstanceLock());
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("before-input-event", (event, input) => {
      const command = commandAliasForInput(input);
      if (!command) return;
      event.preventDefault();
      dispatchAppCommand(command);
    });
  });
  app.on("activate", () => {
    if (!mainWindow) void runStartup(createWindow, failStartup);
  });
  void app.whenReady().then(() => runStartup(async () => {
    const profileState = await initializePortableData(runtimeProfile, async () => {
      const copy = getCopy(app.getLocale());
      const result = await dialog.showMessageBox({
        type: "question",
        title: copy.portableImportTitle,
        message: copy.portableImportMessage,
        buttons: [copy.portableImport, copy.portableStartFresh],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      return result.response === 0;
    }, legacyDataAvailable);
    if (profileState === "import_staged") {
      app.relaunch();
      app.exit(0);
      return;
    }
    if (legacyProfileLock) {
      app.releaseSingleInstanceLock();
      legacyProfileLock = false;
      instanceLockHeld = app.requestSingleInstanceLock();
      if (!instanceLockHeld) {
        app.quit();
        return;
      }
    }
    desktopDatabase = DesktopDatabase.open(join(app.getPath("userData"), "polyask.sqlite"));
    applyPortableImportIdentity(runtimeProfile, (deviceId) => {
      desktopDatabase!.adoptImportedProfile(deviceId);
    });
    createMenu();
    await createWindow();
  }, failStartup));
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    desktopDatabase?.close();
    desktopDatabase = null;
  });
}
