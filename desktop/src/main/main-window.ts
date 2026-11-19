import { existsSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, screen, webContents } from "electron";

import type { CommandPaletteShortcutMode } from "../shared/command-palette-shortcut";
import type { CommandId } from "../shared/commands";
import { formatCopy, getCopy } from "../shared/copy";
import { parseDesktopUiState, type DesktopUiState } from "../shared/desktop-ui-state";
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from "../shared/display";
import type { SiteKey } from "../shared/contracts";
import { prepareApplicationMenu } from "./application-command-routing";
import { initialShellBackground, installNativeShell } from "./native-shell";
import type { PreferenceRuntime } from "./preference-runtime";
import { isTrustedShellUrl } from "./security";
import { UiStateStore } from "./ui-state-store";
import type { ViewManager } from "./view-manager";
import { runViewMenuAction } from "./view-menu-actions";

export interface ApplicationMenuControllerOptions {
  readonly getLocale: () => string;
  readonly getAppName: () => string;
  readonly getMode: () => CommandPaletteShortcutMode;
  readonly getManager: () => ViewManager | null;
  readonly getMainWindow: () => BrowserWindow | null;
  readonly getPreferences: () => PreferenceRuntime | null;
  readonly dispatchAppCommand: (id: CommandId) => void;
  readonly applyDisplayFallback: (manager: ViewManager, value: DisplayPreferences) => void;
}

export interface ApplicationMenuController {
  readonly createMenu: () => void;
  readonly prepareMenu: (mode: CommandPaletteShortcutMode) => ReturnType<typeof prepareApplicationMenu>;
}

export function createApplicationMenuController(
  options: ApplicationMenuControllerOptions
): ApplicationMenuController {
  const prepareMenu = (mode: CommandPaletteShortcutMode): ReturnType<typeof prepareApplicationMenu> => {
    const copy = getCopy(options.getLocale());
    const manager = options.getManager();
    const display = manager?.getDisplayPreferences() ?? DEFAULT_DISPLAY_PREFERENCES;
    return prepareApplicationMenu([
      process.platform,
      copy,
      display,
      (value) => {
        const preferences = options.getPreferences();
        const activeManager = options.getManager();
        if (preferences) preferences.setDisplay(value);
        else if (activeManager) options.applyDisplayFallback(activeManager, value);
      },
      options.dispatchAppCommand,
      options.getAppName(),
      (action) => runViewMenuAction(
        action,
        options.getManager(),
        options.getMainWindow()?.webContents ?? null,
        webContents.getFocusedWebContents()
      ),
      mode
    ]);
  };
  return {
    prepareMenu,
    createMenu: () => {
      prepareMenu(options.getMode()).commit();
    }
  };
}

export interface CreateMainWindowOptions {
  readonly userDataPath: string;
  readonly selectedSites: readonly SiteKey[];
  readonly copy: ReturnType<typeof getCopy>;
  readonly preview: boolean;
  readonly preloadEntry: string;
  readonly shellEntry: string;
}

export interface CreatedMainWindow {
  readonly window: BrowserWindow;
  readonly uiStateStore: UiStateStore;
  readonly initialUiState: DesktopUiState;
  readonly bindUiStatePersistence: (getUiState: () => DesktopUiState) => void;
}

function resolveMainWindowIcon(platform: NodeJS.Platform): string | undefined {
  if (platform === "darwin") return undefined;
  const fileName = platform === "win32" ? "icon.ico" : "icon.png";
  const baseDir = app?.isPackaged
    ? process.resourcesPath
    : typeof app?.getAppPath === "function"
      ? join(app.getAppPath(), "resources")
      : null;
  if (!baseDir) return undefined;
  const candidate = join(baseDir, fileName);
  return existsSync(candidate) ? candidate : undefined;
}

export function createMainWindow(options: CreateMainWindowOptions): CreatedMainWindow {
  const uiStateStore = new UiStateStore(join(options.userDataPath, "desktop-ui-state.json"));
  const initialUiState = parseDesktopUiState(
    uiStateStore.load(),
    screen.getAllDisplays().map((display) => display.workArea),
    options.selectedSites
  );
  const bounds = initialUiState.windowBounds;
  const restorePosition = !(process.platform === "linux"
    && process.env.XDG_SESSION_TYPE?.toLowerCase() === "wayland");
  const windowTitle = options.preview
    ? formatCopy(options.copy.previewWindowTitle, { title: options.copy.appTitle })
    : options.copy.appTitle;
  const windowIcon = resolveMainWindowIcon(process.platform);
  const window = new BrowserWindow({
    title: windowTitle,
    ...(windowIcon ? { icon: windowIcon } : {}),
    width: bounds?.width ?? 1600,
    height: bounds?.height ?? 1050,
    ...(bounds && restorePosition ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 960,
    minHeight: 680,
    frame: false,
    show: false,
    backgroundColor: initialShellBackground(),
    webPreferences: {
      preload: options.preloadEntry,
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
  const guardShellNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedShellUrl(url, options.shellEntry)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardShellNavigation);
  window.webContents.on("will-redirect", guardShellNavigation);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return {
    window,
    uiStateStore,
    initialUiState,
    bindUiStatePersistence: (getUiState) => {
      window.on("move", () => uiStateStore.schedule(getUiState()));
      window.on("maximize", () => uiStateStore.schedule(getUiState()));
      window.on("unmaximize", () => uiStateStore.schedule(getUiState()));
      window.on("close", () => uiStateStore.save(getUiState()));
      window.once("ready-to-show", () => {
        if (initialUiState.maximized) window.maximize();
        window.show();
      });
    }
  };
}
