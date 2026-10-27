import { dispatchAppCommand as dispatchShellCommand } from './app-command-dispatch';
import { prepareApplicationMenu, bindApplicationCommandInput } from './application-command-routing';
import type { CommandPaletteShortcutMode } from '../shared/command-palette-shortcut';
import { CommandPaletteShortcutRuntime } from './command-palette-shortcut';
import { CommandPaletteShortcutRepository } from './command-palette-shortcut-repository';
import { runViewMenuAction } from "./view-menu-actions";
import { installNativeShell, initialShellBackground } from "./native-shell";
import { createWindowDataServices } from './window-data-services';
import type { PreferenceRuntime } from './preference-runtime';
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  screen,
  shell as electronShell,
  webContents,
} from "electron";
import squirrelStartup from "electron-squirrel-startup";

import type { CommandId } from "../shared/commands";
import { getCopy } from "../shared/copy";
import { parseDesktopUiState } from "../shared/desktop-ui-state";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayPreferences
} from "../shared/display";
import type { RuntimeInfo } from "../shared/runtime";
import { BroadcastCoordinator } from "./broadcast";
import { CollectionService } from "./collection-service";
import { createCompletionNotifications } from './completion-notifications';
import { GlobalPromptShortcutRuntime } from './global-prompt-shortcut';
import { GlobalPromptShortcutRepository } from './global-prompt-shortcut-repository';
import type { QuestionHistoryService } from './question-history-service';
import { DesktopDatabase } from "./database";
import {
  applyPortableImportIdentity,
  finalizePortableDataImport,
  hasImportableLegacyData,
  initializePortableData,
  isPortableDataInitialized,
  resolveRuntimeProfile
} from "./portable-profile";
import { createProxyServices, type ProxyServices } from "./proxy-services";
import { blockProxyUntilApplied } from "./proxy-startup-block";
import { disableWebBadging } from "./web-badging";
import { createProxyTools } from "./proxy-tools";
import { isTrustedShellUrl, safeExternalUrl } from "./security";
import { startRuntimeGates } from "./runtime-gates";
import { registerShellIpc } from "./shell-ipc";
import { SITES } from "./sites";
import { runStartup } from "./startup";
import { showStartupFailure } from "./startup-failure";
import { UiStateStore } from "./ui-state-store";
import { ViewManager } from "./view-manager";
import { WorkspaceService } from "./workspace-service";

if (squirrelStartup) app.quit();
// ready 之前：每个 session 一实例化就会出网（拼写词典），首次 setProxy 之前一律走阻断地址。
blockProxyUntilApplied(app.commandLine);
disableWebBadging(app, WEB_BADGING_PRELOAD_WEBPACK_ENTRY);
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
let proxyServices: ProxyServices | null = null;
let promptShortcut: GlobalPromptShortcutRuntime | null = null;
let paletteShortcut: CommandPaletteShortcutRuntime | null = null;

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

function createMenu(): void { prepareMenu(paletteShortcut?.getState().mode ?? 'standard').commit(); }
function prepareMenu(mode: CommandPaletteShortcutMode): ReturnType<typeof prepareApplicationMenu> {
  const copy = getCopy(app.getLocale());
  const display = viewManager?.getDisplayPreferences() ?? DEFAULT_DISPLAY_PREFERENCES;
  return prepareApplicationMenu([process.platform, copy, display,
    (value) => { if (preferenceRuntime) preferenceRuntime.setDisplay(value); else if (viewManager) applyDisplayPreferences(viewManager, value); }, dispatchAppCommand, app.name,
    (action) => runViewMenuAction(action, viewManager, mainWindow?.webContents ?? null, webContents.getFocusedWebContents()), mode]);
}

async function createWindow(): Promise<void> {
  const copy = getCopy(app.getLocale());
  if (!desktopDatabase) throw new Error("database_not_ready");
  const database = desktopDatabase;
  const proxy = proxyServices;
  if (!proxy) throw new Error("proxy_not_ready");
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
  let notificationQuestions: QuestionHistoryService | null = null;
  const completionNotifier = createCompletionNotifications({ window, copy,
    questions: () => notificationQuestions, publish: sendToShell });
  window.once('closed', () => completionNotifier.dispose());
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, MAIN_WINDOW_WEBPACK_ENTRY)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const runtimeGates = startRuntimeGates(window);
  // fail-closed：代理应用并校验（存储值损坏则进入阻断）之后才构造 ViewManager——首个站点 loadURL 就在它的构造里。
  await proxy.runtime.recomputeFromStore();
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
      webrtcPolicy: () => proxy.runtime.webrtcPolicy(),
      proxyAuthFailed: () => proxy.auth.authFailed(),
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
    database, manager, workspace, coordinator, synthesisCoordinator, proxy, publish: sendToShell,
    applyDisplay: value => applyDisplayPreferences(manager, value),
    setNotifications: enabled => completionNotifier.setEnabled(enabled)
  });
  preferenceRuntime = preferences;
  notificationQuestions = questions;
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
    dataAdmin, preferences, proxy: { ...proxy, ...createProxyTools(proxy, manager, () => workspace.getState().selectedSites) },
    completionNotifications: completionNotifier, globalPromptShortcut: promptShortcut ?? undefined,
    commandPaletteShortcut: paletteShortcut ?? undefined,
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

const failStartup = (error: unknown): void => showStartupFailure(error, runtimeProfile.distribution);

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
    bindApplicationCommandInput(contents, () => paletteShortcut?.getState().mode ?? 'standard', dispatchAppCommand);
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
    proxyServices = createProxyServices(desktopDatabase);
    promptShortcut = new GlobalPromptShortcutRuntime({ shortcuts: globalShortcut,
      repository: new GlobalPromptShortcutRepository(desktopDatabase.meta), activate: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show(); mainWindow.focus(); dispatchAppCommand('edit-prompt');
      } });
    promptShortcut.restore();
    paletteShortcut = new CommandPaletteShortcutRuntime({ repository: new CommandPaletteShortcutRepository(desktopDatabase.meta),
      transaction: action => desktopDatabase!.transaction(action), prepare: prepareMenu,
      publish: state => sendToShell('polyask:command-palette-shortcut-changed', state) });
    paletteShortcut.restore();
    createMenu();
    await createWindow();
  }, failStartup));
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    promptShortcut?.dispose();
    paletteShortcut?.dispose();
    desktopDatabase?.close();
    desktopDatabase = null;
  });
}
