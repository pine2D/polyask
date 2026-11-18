import type { RefObject } from "react";
import { resolveCommands, type CommandId } from "../shared/commands";
import type { LayoutMode, SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { PromptLibraryState } from "../shared/prompt-library";
import type {
  DesktopSurface,
  LayoutState,
  MenuShortcut,
  SiteNavigationHistoryState,
  SiteStatus
} from "../shared/protocol";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { executeCommand, type CommandActions } from "./command-dispatcher";
import { CommandPalette, type CommandPaletteMode } from "./command-palette";
import { focusPromptForEditing } from "./composer-activation";
import type { SettingsTarget } from "./settings-categories";
import { shell } from "./shell-api";
import { nextSiteForStatus } from "./site-navigation";
import type { WorkspacePanelState, WorkspacePanelTab } from "./workspace-panel-state";

export const LATEST_RELEASE_URL = "https://github.com/pine2D/polyask/releases/latest";

export interface BuildAppCommandsOptions {
  readonly copy: DesktopCopy;
  readonly layout: LayoutState;
  readonly openedSites: readonly SiteKey[];
  readonly participatingSites: ReadonlySet<SiteKey>;
  readonly statuses: Record<string, SiteStatus>;
  readonly siteNavigationHistory: Record<string, SiteNavigationHistoryState>;
  readonly drawerOpen: boolean;
  readonly composer: {
    readonly expanded: boolean;
    readonly setExpanded: (value: boolean) => void;
  };
  readonly promptRef: RefObject<HTMLTextAreaElement | null>;
  readonly requestedPage: { current: { readonly page: number; readonly inputMethod: "keyboard" | "pointer" } | null };
  readonly setPageInputMethod: (method: "keyboard" | "pointer") => void;
  readonly setAnnouncement: (text: string, polite?: boolean, persist?: boolean) => void;
  readonly changeSurface: (value: DesktopSurface) => void;
  readonly changeDrawerOpen: (value: boolean) => void;
  readonly changePanelState: (value: WorkspacePanelState) => void;
  readonly openPanel: (tab: WorkspacePanelTab, inputMethod: "pointer" | "keyboard") => void;
  readonly openCommandSurface: (mode: CommandPaletteMode) => void;
  readonly openTaskSetup: () => void;
  readonly openSettings: (section: SettingsTarget) => void;
  readonly setMode: (mode: LayoutMode, focused?: SiteKey) => void;
  readonly changeTier: (tier: "think" | "fast") => void;
  readonly closeQuestionHistory: () => void;
  readonly openQuestionHistory: () => void;
  readonly closeImagePicker: () => void;
  readonly collectAndCopy: (() => Promise<void>) | undefined;
  readonly collectAndCompare: (() => Promise<void>) | undefined;
  readonly collectSynthesis: () => Promise<void>;
  readonly synthesisPending: boolean;
  readonly retrySitesCount: number;
  readonly requestRetryReview: () => void;
  readonly clearArchiveNavigation: () => void;
  readonly startNewSession: () => Promise<void>;
}

export function openLatestReleasePage(): Promise<void> {
  return shell.openExternal(LATEST_RELEASE_URL);
}

export function buildAppCommands(options: BuildAppCommandsOptions): CommandActions {
  const {
    copy,
    layout,
    openedSites,
    participatingSites,
    statuses,
    siteNavigationHistory,
    drawerOpen,
    composer,
    promptRef,
    requestedPage,
    setPageInputMethod,
    setAnnouncement,
    changeSurface,
    changeDrawerOpen,
    changePanelState,
    openPanel,
    openCommandSurface,
    openTaskSetup,
    openSettings,
    setMode,
    changeTier,
    closeQuestionHistory,
    openQuestionHistory,
    closeImagePicker,
    collectAndCopy,
    collectAndCompare,
    collectSynthesis,
    synthesisPending,
    retrySitesCount,
    requestRetryReview,
    clearArchiveNavigation,
    startNewSession
  } = options;

  const showPage = (page: number): void => {
    changeSurface("sites");
    requestedPage.current = { page, inputMethod: "keyboard" };
    setPageInputMethod("keyboard");
    setAnnouncement(formatCopy(copy.sitePageChanged, { page: page + 1, total: layout.pageCount }));
    shell.setPage(page);
  };
  const nextUnfinished = nextSiteForStatus(
    openedSites, layout.focused, statuses, "unfinished"
  );
  const nextFailed = nextSiteForStatus(
    openedSites, layout.focused, statuses, "failed"
  );
  const focusSite = (site: SiteDefinition["key"]): void => {
    changeSurface("sites");
    if (drawerOpen) changeDrawerOpen(false);
    setMode("focus", site);
  };
  const activatePrompt = (): void => {
    changeSurface("sites");
    closeQuestionHistory();
    changePanelState(null);
    focusPromptForEditing(promptRef, composer.setExpanded);
  };
  const focusCurrentSite = (): void => {
    changeSurface("sites");
    closeQuestionHistory();
    changePanelState(null);
    closeImagePicker();
    // 同一外壳按顺序解除问答/搜索覆盖，再把键盘交回当前原生视图。
    void shell.setQuestionPanel(false).catch(() => {});
    void shell.closeSiteFind(false).catch(() => {});
    shell.focusCurrentSite();
  };
  const checkForUpdates = (): void => {
    changeSurface("sites");
    void openLatestReleasePage()
      .then(() => setAnnouncement(copy.updatePageOpened))
      .catch(() => setAnnouncement(copy.updatePageFailed));
  };

  return {
    "open-command-palette": () => openCommandSurface("commands"),
    "open-task-setup": openTaskSetup,
    "open-sites": () => {
      openPanel("sites", "keyboard");
    },
    "open-site-health": () => {
      openPanel("health", "keyboard");
    },
    ...(layout.pageCount >= 1 ? { "show-page-1": () => showPage(0) } : {}),
    ...(layout.pageCount >= 2 ? { "show-page-2": () => showPage(1) } : {}),
    ...(layout.pageCount >= 3 ? { "show-page-3": () => showPage(2) } : {}),
    // 翻页/换焦点交给主进程的 ViewManager，渲染层不重算（重算必与主进程漂开）
    ...(layout.pageCount > 1 ? {
      "next-page": () => { changeSurface("sites"); shell.stepPage(1); },
      "previous-page": () => { changeSurface("sites"); shell.stepPage(-1); }
    } : {}),
    ...(openedSites.length > 1 ? {
      "next-site": () => { changeSurface("sites"); shell.stepSite(1); },
      "previous-site": () => { changeSurface("sites"); shell.stepSite(-1); }
    } : {}),
    // 站内后退/前进作用于当前聚焦的站点；能不能退由主进程按真实导航历史判定。
    ...(siteNavigationHistory[layout.focused]?.back ? { "site-back": () => { changeSurface("sites"); shell.stepHistory(-1); } } : {}),
    ...(siteNavigationHistory[layout.focused]?.forward ? { "site-forward": () => { changeSurface("sites"); shell.stepHistory(1); } } : {}),
    "focus-current-site": focusCurrentSite,
    "set-layout-duel": () => { changeSurface("sites"); setMode("duel"); },
    "edit-prompt": activatePrompt,
    "focus-prompt": () => {
      if (composer.expanded) { composer.setExpanded(false); focusCurrentSite(); }
      else activatePrompt();
    },
    'find-page': () => {
      changeSurface('sites'); closeQuestionHistory(); changePanelState(null); closeImagePicker();
      void shell.setQuestionPanel(false).then(() => shell.openSiteFind()).catch(() => setAnnouncement(copy.findFailed));
    },
    "set-think": () => { changeSurface("sites"); changeTier("think"); },
    "set-fast": () => { changeSurface("sites"); changeTier("fast"); },
    ...(participatingSites.size > 0 && collectAndCopy ? { "collect-answers": () => { changeSurface("sites"); void collectAndCopy(); } } : {}),
    ...(collectAndCompare ? { "collect-compare": () => { changeSurface("sites"); void collectAndCompare(); } } : {}),
    "open-question-history": openQuestionHistory,
    "open-archive": () => { clearArchiveNavigation(); changeSurface("archive"); },
    ...(synthesisPending ? { "collect-synthesis": () => { changeSurface("sites"); void collectSynthesis(); } } : {}),
    ...(retrySitesCount > 0 ? {
      "retry-failed": () => requestRetryReview()
    } : {}),
    ...(nextUnfinished ? { "next-unfinished": () => focusSite(nextUnfinished) } : {}),
    ...(nextFailed ? { "next-failed": () => focusSite(nextFailed) } : {}),
    ...(participatingSites.size > 0 ? { "new-session": () => { void startNewSession(); } } : {}),
    "open-settings": () => openSettings("appearance"),
    "open-drive-diagnostics": () => openSettings("drive-diagnostics"),
    "open-display-settings": () => openSettings("display"),
    "open-data-settings": () => openSettings("data"),
    "open-shortcuts": () => openCommandSurface("shortcuts"),
    "open-getting-started": () => openCommandSurface("guide"),
    "check-updates": checkForUpdates
  };
}

export interface CommandPaletteSurfaceProps {
  readonly copy: DesktopCopy;
  readonly shortcutMode: Parameters<typeof resolveCommands>[0];
  readonly commandActions: { current: CommandActions };
  readonly pageCount: number;
  readonly menuShortcuts: readonly MenuShortcut[];
  readonly groups: readonly ActiveWorkspaceGroup[];
  readonly library: PromptLibraryState;
  readonly draft: string;
  readonly isMac: boolean;
  readonly mode: CommandPaletteMode;
  readonly onModeChange: (mode: CommandPaletteMode) => void;
  readonly onApplyGroup: (sites: readonly SiteKey[]) => Promise<unknown>;
  readonly onReplaceDraft: (value: string) => void;
  readonly onLibrarySaved: (library: PromptLibraryState) => void;
  readonly onDeleteTemplate: (id: string) => void;
  readonly onAnnounce: (text: string, polite?: boolean, persist?: boolean) => void;
  readonly onClose: () => void;
}

export function CommandPaletteSurface(props: CommandPaletteSurfaceProps): React.JSX.Element {
  const commands = resolveCommands(props.shortcutMode);
  const availableCommands = commands.filter((command) => !!props.commandActions.current[command.id]);
  return (
    <CommandPalette
      copy={props.copy}
      commands={availableCommands}
      shortcutCommands={commands}
      pageCount={props.pageCount}
      menuShortcuts={props.menuShortcuts}
      groups={props.groups}
      library={props.library}
      draft={props.draft}
      isMac={props.isMac}
      mode={props.mode}
      onModeChange={props.onModeChange}
      onExecute={(id: CommandId) => executeCommand(id, props.commandActions.current)}
      onApplyGroup={(id) => {
        const group = props.groups.find((candidate) => candidate.id === id);
        if (!group) return;
        void props.onApplyGroup(group.sites);
        props.onClose();
      }}
      onInsertPrompt={(value) => {
        props.onClose();
        props.onReplaceDraft(value);
      }}
      onSaveTemplate={async (input: Parameters<typeof shell.savePromptTemplate>[0]) => {
        try {
          const library = await shell.savePromptTemplate(input);
          props.onLibrarySaved(library);
          props.onAnnounce(props.copy.templateSaved, true, true);
          return true;
        } catch {
          props.onAnnounce(props.copy.promptLibrarySaveFailed);
          return false;
        }
      }}
      onDeleteTemplate={props.onDeleteTemplate}
      onClose={props.onClose}
    />
  );
}
