import type { QuestionAttachmentsManifest, QuestionReask } from '../shared/question-attachments';
import type { DesktopImage } from '../shared/images';
import type { GeneralPreferenceGroup, PreferenceKey, PreferenceSnapshot, PreferenceValues } from '../shared/preferences';
import type { DraftInput, DraftKind, StoredDraft } from '../shared/drafts';
import type { QuestionDetail, QuestionPage, QuestionFilters, QuestionLegacyPage } from "../shared/question-history";
import type { QuestionArchiveRequest } from "../shared/question-archive";
import type { SitePageClosePreview, SitePageCloseRequest, SitePageCloseResult } from '../shared/site-page';
import type { QuestionRunProgress } from '../shared/question-run-progress';
import type { LocalDataStats } from "../shared/local-data";
import type { QuestionRestorePreview, QuestionRestoreResult } from "../shared/question-restore";
import type { BackupPreview, BackupApplyResult, BackupSelectionPreview, BackupExportMode, BackupExportResult } from "../shared/backup";
import type { TaskFolder, TaskFolderSummary, FolderTarget, FolderMembershipChange, FolderFilters, FolderContent } from "../shared/task-folder";
import type { FolderContentPage, FolderPageRequest } from '../shared/task-folder-page';
import type { DecisionFilters, DecisionInput, DecisionRecord } from "../shared/decision";
import { contextBridge, ipcRenderer } from "electron";
import type { RuntimeProcessFailure } from "../shared/runtime-process";
import type { CaptureLocateCounts } from "../shared/question-capture";
import type { SiteFindRequest, SiteFindState } from '../shared/site-find';

import { ipcErrorCode } from "../shared/ipc-error";

import type {
  ArchiveFilters,
  ArchiveInput,
  ArchivePatch,
  ArchiveRecord,
  ArchiveSearchResult
} from "../shared/archive";
import type { SiteKey } from "../shared/contracts";
import type { CommandId } from "../shared/commands";
import type { PromptLibraryState, PromptTemplate } from "../shared/prompt-library";
import type { DisplayPreferences } from "../shared/display";
import type {
  BootstrapState,
  BroadcastRequest,
  CollectedAnswer,
  CollectionRequest,
  DesktopSurface,
  LayoutState,
  MenuShortcut,
  NewSessionSiteResult,
  SiteHistoryState,
  SiteRunResult,
  SiteStatus
} from "../shared/protocol";
import type { WorkspaceState } from "../shared/workspace";
import type { SyncStatus } from "../shared/sync";
import type { SyncDiagnosticSnapshot } from "../shared/sync-diagnostics";
import type { SiteHealth } from "../shared/site-health";
import type {
  SynthesisCandidate,
  SynthesisSendRequest,
  SynthesisSendResponse
} from "../shared/synthesis";
import type { ProxyAcceptRequest, ProxyReloadResult, ProxySetRequest, ProxyStateRequest, ProxyStateView, ProxyTestRequest, ProxyTestResult, ProxyWriteResult } from "../shared/proxy-state";

export interface PolyAskDesktopApi {
  openSiteFind(): Promise<SiteFindState>;
  getSiteFind(): Promise<SiteFindState>;
  findSites(request: SiteFindRequest): Promise<SiteFindState>;
  moveSiteFind(direction: -1 | 1): Promise<SiteFindState>;
  selectSiteFind(site: SiteKey): Promise<SiteFindState>;
  closeSiteFind(restoreFocus?: boolean): Promise<SiteFindState>;
  onSiteFind(listener: (state: SiteFindState) => void): () => void;
  getPreferences(): Promise<PreferenceSnapshot>;
  seedPreferences(values: Partial<PreferenceValues>): Promise<PreferenceSnapshot>;
  setPreference(key: PreferenceKey, value: unknown): Promise<PreferenceSnapshot>;
  followPreferences(group: GeneralPreferenceGroup, enabled: boolean): Promise<PreferenceSnapshot>;
  setDraftSync(enabled: boolean): Promise<PreferenceSnapshot>;
  onPreferences(listener: (value: PreferenceSnapshot) => void): () => void;
  listDrafts(kind?: DraftKind, context?: string): Promise<{ epoch: number; deviceId: string; drafts: StoredDraft[] }>;
  saveDraft(input: DraftInput, epoch: number): Promise<StoredDraft>;
  removeDraft(id: string, updatedAt: number, epoch: number): Promise<boolean>;
  onDraftsChanged(listener: () => void): () => void;
  clearDrafts(confirmed: true): Promise<number>;
  getQuestionRunProgress(runId: string): Promise<QuestionRunProgress | null>;
  onQuestionRunProgress(listener: (progress: QuestionRunProgress) => void): () => void;
  previewSitePageClose(site: SiteKey): Promise<SitePageClosePreview>;
  closeSitePage(request: SitePageCloseRequest): Promise<SitePageCloseResult>;
  setQuestionPanel(open: boolean): Promise<void>;
  listLegacyQuestions(filters?: QuestionFilters): Promise<QuestionLegacyPage>;
  listQuestions(filters: QuestionFilters): Promise<QuestionPage>;
  getQuestion(id: string, answerId?: string): Promise<QuestionDetail | null>;
  questionAttachments(questionId: string): Promise<QuestionAttachmentsManifest | null>;
  questionAttachment(request: { questionId: string; index: number }): Promise<DesktopImage>;
  questionReask(questionId: string): Promise<QuestionReask>;
  questionFetchAttachments?(questionId: string): Promise<boolean>;
  onQuestionAttachmentSaveFailed(listener: () => void): () => void;
  createQuestionArchive(request: QuestionArchiveRequest): Promise<ArchiveRecord>;
  getLocalDataStats(): Promise<LocalDataStats>;
  previewQuestion(questionId: string, answerId?: string): Promise<QuestionRestorePreview>;
  restoreQuestion(token: string, confirmed: boolean): Promise<QuestionRestoreResult[]>;
  cancelQuestionRestore(): Promise<void>;
  deleteQuestion(id: string): Promise<boolean>;
  onQuestionSaveFailed(listener: () => void): () => void;
  bootstrap(): Promise<BootstrapState>;
  menuShortcuts(): Promise<MenuShortcut[]>;
  broadcast(request: BroadcastRequest): Promise<SiteRunResult[]>;
  collectAnswers(request: CollectionRequest): Promise<CollectedAnswer[]>;
  exportBackup(mode?: BackupExportMode): Promise<BackupExportResult>;
  previewBackup(): Promise<BackupPreview | null>;
  previewBackupSelection(token: string, selectedKeys: readonly string[]): Promise<BackupSelectionPreview>;
  applyBackup(token: string, selectedKeys: readonly string[]): Promise<BackupApplyResult>;
  cancelBackup(token: string): Promise<void>;
  listFolders(): Promise<TaskFolderSummary[]>;
  createFolder(name: string): Promise<TaskFolder>;
  renameFolder(id: string, name: string): Promise<TaskFolder>;
  deleteFolder(id: string): Promise<void>;
  searchFolderContents(filters: FolderFilters): Promise<FolderContent[]>;
  queryFolderContents(request: FolderPageRequest): Promise<FolderContentPage>;
  folderMemberships(target: FolderTarget): Promise<string[]>;
  patchFolderMemberships(target: FolderTarget, changes: readonly FolderMembershipChange[]): Promise<string[]>;
  clearFolders(): Promise<number>;
  searchDecisions(filters: DecisionFilters): Promise<DecisionRecord[]>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  createDecision(input: DecisionInput): Promise<DecisionRecord>;
  updateDecision(id: string, input: DecisionInput): Promise<DecisionRecord>;
  deleteDecision(id: string): Promise<void>;
  decisionMarkdown(id: string, locale: string): Promise<string>;
  searchArchives(filters: ArchiveFilters): Promise<ArchiveSearchResult>;
  listArchiveTags(): Promise<string[]>;
  getArchive(id: string): Promise<ArchiveRecord | null>;
  addArchive(input: ArchiveInput): Promise<ArchiveRecord>;
  updateArchive(id: string, patch: ArchivePatch): Promise<ArchiveRecord>;
  deleteArchive(id: string): Promise<void>;
  archiveMarkdown(id: string, locale: string): Promise<string>;
  sendSynthesis(request: SynthesisSendRequest): Promise<SynthesisSendResponse>;
  collectSynthesis(): Promise<SynthesisCandidate>;
  saveSynthesis(replaceExisting: boolean): Promise<ArchiveRecord>;
  openExternal(url: string): Promise<void>;
  cancel(): void;
  /** 只取消辅助综合的派发与导航，不碰群发（群发取消会作废上一轮「提交未确认」的迟到确认）。 */
  cancelSynthesis(): void;
  setLayout(mode: "overview" | "focus", focused: SiteKey): void;
  inspectSite(site: SiteKey): Promise<boolean>;
  setPage(page: number): void;
  stepPage(offset: -1 | 1): void;
  stepSite(offset: -1 | 1): void;
  stepHistory(offset: -1 | 1, site?: SiteKey): void;
  siteHistoryState(): Promise<Record<string, SiteHistoryState>>;
  setDisplayPreferences(value: DisplayPreferences): Promise<DisplayPreferences>;
  setComposerExpanded(value: boolean): void;
  setDrawerOpen(value: boolean): void;
  setSurface(value: DesktopSurface): void;
  setSelection(sites: readonly SiteKey[]): Promise<WorkspaceState>;
  setParticipation(sites: readonly SiteKey[]): Promise<WorkspaceState>;
  setTier(value: BroadcastRequest["tier"]): Promise<WorkspaceState>;
  saveGroup(input: { readonly name: string; readonly sites: readonly SiteKey[] }): Promise<WorkspaceState>;
  deleteGroup(id: string): Promise<WorkspaceState>;
  newSession(sites: readonly SiteKey[]): Promise<NewSessionSiteResult[]>;
  showGroupMenu(): Promise<string | null>;
  showCommandMenu(commands: readonly CommandId[]): Promise<CommandId | null>;
  setCompletionNotifications(enabled: boolean): void;
  savePromptTemplate(input: { readonly name: string; readonly text: string }): Promise<PromptLibraryState>;
  deletePromptTemplate(id: string): Promise<PromptLibraryState>;
  connectSync(): Promise<SyncStatus>;
  syncNow(): Promise<SyncStatus>;
  setImageSyncEnabled(enabled: boolean, confirmed?: boolean): Promise<SyncStatus>;
  disconnectSync(): Promise<SyncStatus>;
  clearRemoteSync(confirmation: string): Promise<SyncStatus>;
  syncDiagnostics(): Promise<SyncDiagnosticSnapshot>;
  checkSiteHealth(sites: readonly SiteKey[]): Promise<SiteHealth[]>;
  getRuntimeProcessFailures(): Promise<RuntimeProcessFailure[]>;
  getCaptureLocateCounts(): Promise<CaptureLocateCounts>;
  reloadSite(site: SiteKey, ignoreCache?: boolean): Promise<boolean>;
  clearSiteData(site: SiteKey): Promise<boolean>;
  clearHistory(): Promise<number>;
  clearDecisions(): Promise<number>;
  clearArchives(): Promise<number>;
  resetLocalData(): Promise<SyncStatus>;
  onStatus(listener: (status: SiteStatus) => void): () => void;
  onLayout(listener: (layout: LayoutState) => void): () => void;
  onDisplayPreferences(listener: (value: DisplayPreferences) => void): () => void;
  onCommand(listener: (id: CommandId) => void): () => void;
  onWorkspaceState(listener: (value: WorkspaceState) => void): () => void;
  onPromptLibrary(listener: (value: PromptLibraryState) => void): () => void;
  onSyncStatus(listener: (value: SyncStatus) => void): () => void;
  getProxyState(request?: ProxyStateRequest): Promise<ProxyStateView>;
  saveProxy(request: ProxySetRequest): Promise<ProxyWriteResult>;
  followProxy(enabled: boolean): Promise<ProxyWriteResult>;
  acceptProxy(request: ProxyAcceptRequest): Promise<ProxyWriteResult>;
  testProxy(request: ProxyTestRequest): Promise<ProxyTestResult>;
  reloadProxySites(): Promise<ProxyReloadResult>;
  onProxyState(listener: (value: ProxyStateView) => void): () => void;
}

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

// 全部 invoke 走这一层：把 Electron 的远程调用前缀剥掉，渲染层拿到的 error.message 就是主进程抛的裸码。
const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => { throw new Error(ipcErrorCode(error)); });

const api: PolyAskDesktopApi = Object.freeze({
  openSiteFind: () => invoke('polyask:find-open'),
  getSiteFind: () => invoke('polyask:find-state'),
  findSites: (request: SiteFindRequest) => invoke('polyask:find-query', request),
  moveSiteFind: (direction: -1 | 1) => invoke('polyask:find-move', direction),
  selectSiteFind: (site: SiteKey) => invoke('polyask:find-select', site),
  closeSiteFind: (restoreFocus?: boolean) => invoke('polyask:find-close', restoreFocus),
  onSiteFind: (listener: (state: SiteFindState) => void) => subscribe('polyask:find-state', listener),
  getPreferences: () => invoke('polyask:preferences'),
  seedPreferences: (values: Partial<PreferenceValues>) => invoke('polyask:preferences-seed', values),
  setPreference: (key: PreferenceKey, value: unknown) => invoke('polyask:preference-set', { key, value }),
  followPreferences: (group: GeneralPreferenceGroup, enabled: boolean) => invoke('polyask:preferences-follow', { group, enabled }),
  setDraftSync: (enabled: boolean) => invoke('polyask:draft-sync', enabled),
  onPreferences: (listener: (value: PreferenceSnapshot) => void) => subscribe('polyask:preferences-changed', listener),
  listDrafts: (kind?: DraftKind, context?: string) => invoke('polyask:draft-list', { kind, context }),
  saveDraft: (input: DraftInput, epoch: number) => invoke('polyask:draft-save', { input, epoch }),
  removeDraft: (id: string, updatedAt: number, epoch: number) => invoke('polyask:draft-remove', { id, updatedAt, epoch }),
  onDraftsChanged: (listener: () => void) => subscribe('polyask:drafts-changed', listener),
  clearDrafts: (confirmed: true) => invoke('polyask:clear-drafts', confirmed),
  getQuestionRunProgress: (runId: string) => invoke('polyask:question-run-progress', runId),
  onQuestionRunProgress: (listener: (progress: QuestionRunProgress) => void) => {
    const handler = (_event: unknown, progress: QuestionRunProgress) => listener(progress);
    ipcRenderer.on('polyask:question-run-progress', handler);
    return () => ipcRenderer.removeListener('polyask:question-run-progress', handler);
  },
  previewSitePageClose: (site: SiteKey) => invoke('polyask:preview-site-page-close', site),
  closeSitePage: (request: SitePageCloseRequest) => invoke('polyask:close-site-page', request),
  setQuestionPanel: (open: boolean) => invoke("polyask:question-panel", open),
  listLegacyQuestions: (filters?: QuestionFilters) => invoke("polyask:question-legacy", filters),
  listQuestions: (filters: QuestionFilters) => invoke("polyask:question-list", filters),
  getQuestion: (id: string, answerId?: string) => invoke("polyask:question-get", { questionId: id, answerId }),
  questionAttachments: (id: string) => invoke('polyask:question-attachments', id),
  questionAttachment: (request: { questionId: string; index: number }) => invoke('polyask:question-attachment', request),
  questionReask: (id: string) => invoke('polyask:question-reask', id),
  onQuestionAttachmentSaveFailed: (listener: () => void) => subscribe('polyask:question-attachment-save-failed', listener),
  createQuestionArchive: (request: QuestionArchiveRequest) => invoke("polyask:question-archive", request),
  getLocalDataStats: () => invoke("polyask:local-data-stats"),
  previewQuestion: (questionId: string, answerId?: string) => invoke("polyask:question-preview", { questionId, answerId }),
  restoreQuestion: (token: string, confirmed: boolean) => invoke("polyask:question-restore", { token, confirmed }),
  cancelQuestionRestore: () => invoke("polyask:question-cancel"),
  deleteQuestion: (id: string) => invoke("polyask:question-delete", id),
  onQuestionSaveFailed: (listener: () => void) => subscribe("polyask:question-save-failed", listener),
  bootstrap: () => invoke("polyask:bootstrap"),
  menuShortcuts: () => invoke("polyask:menu-shortcuts"),
  broadcast: (request: BroadcastRequest) => invoke("polyask:broadcast", request),
  collectAnswers: (request: CollectionRequest) => invoke("polyask:collect", request),
  exportBackup: (mode?: BackupExportMode) => invoke("polyask:backup-export", mode ? { mode } : undefined),
  previewBackup: () => invoke("polyask:backup-preview"),
  previewBackupSelection: (token: string, selectedKeys: readonly string[]) => invoke("polyask:backup-selection-preview", { token, selectedKeys }),
  applyBackup: (token: string, selectedKeys: readonly string[]) => invoke("polyask:backup-apply", { token, selectedKeys }),
  cancelBackup: (token: string) => invoke("polyask:backup-cancel", token),
  listFolders: () => invoke("polyask:folder-list"),
  createFolder: (name: string) => invoke("polyask:folder-create", name),
  renameFolder: (id: string, name: string) => invoke("polyask:folder-rename", { id, name }),
  deleteFolder: (id: string) => invoke("polyask:folder-delete", id),
  searchFolderContents: (filters: FolderFilters) => invoke("polyask:folder-search", filters),
  queryFolderContents: (request: FolderPageRequest) => invoke('polyask:folder-query', request),
  folderMemberships: (target: FolderTarget) => invoke("polyask:folder-memberships", target),
  patchFolderMemberships: (target: FolderTarget, changes: readonly FolderMembershipChange[]) => invoke("polyask:folder-memberships-patch", { target, changes }),
  clearFolders: () => invoke("polyask:clear-folders"),
  searchDecisions: (filters: DecisionFilters) => invoke("polyask:decision-search", filters),
  getDecision: (id: string) => invoke("polyask:decision-get", id),
  createDecision: (input: DecisionInput) => invoke("polyask:decision-create", input),
  updateDecision: (id: string, input: DecisionInput) => invoke("polyask:decision-update", { id, input }),
  deleteDecision: (id: string) => invoke("polyask:decision-delete", id),
  decisionMarkdown: (id: string, locale: string) => invoke("polyask:decision-markdown", { id, locale }),
  searchArchives: (filters: ArchiveFilters) => invoke("polyask:archive-search", filters),
  listArchiveTags: () => invoke("polyask:archive-tags"),
  getArchive: (id: string) => invoke("polyask:archive-get", id),
  addArchive: (input: ArchiveInput) => invoke("polyask:archive-add", input),
  updateArchive: (id: string, patch: ArchivePatch) => invoke("polyask:archive-update", { id, patch }),
  deleteArchive: (id: string) => invoke("polyask:archive-delete", id),
  archiveMarkdown: (id: string, locale: string) => invoke("polyask:archive-markdown", { id, locale }),
  sendSynthesis: (request: SynthesisSendRequest) => invoke("polyask:synthesis-send", request),
  collectSynthesis: () => invoke("polyask:synthesis-collect"),
  saveSynthesis: (replaceExisting: boolean) => invoke("polyask:synthesis-save", replaceExisting),
  openExternal: (url: string) => invoke("polyask:open-external", url),
  cancel: () => ipcRenderer.send("polyask:cancel"),
  cancelSynthesis: () => ipcRenderer.send("polyask:synthesis-cancel"),
  setLayout: (mode: "overview" | "focus", focused: SiteKey) => ipcRenderer.send("polyask:set-layout", { mode, focused }),
  inspectSite: (site: SiteKey) => invoke("polyask:inspect-site", site),
  setPage: (page: number) => ipcRenderer.send("polyask:set-page", page),
  stepPage: (offset: -1 | 1) => ipcRenderer.send("polyask:step-page", offset),
  stepSite: (offset: -1 | 1) => ipcRenderer.send("polyask:step-site", offset),
  stepHistory: (offset: -1 | 1, site?: SiteKey) => ipcRenderer.send("polyask:step-history", { offset, site }),
  siteHistoryState: () => invoke("polyask:site-history-state"),
  setDisplayPreferences: (value: DisplayPreferences) => invoke("polyask:set-display", value),
  setComposerExpanded: (value: boolean) => ipcRenderer.send("polyask:set-composer-expanded", value),
  setDrawerOpen: (value: boolean) => ipcRenderer.send("polyask:set-drawer-open", value),
  setSurface: (value: DesktopSurface) => ipcRenderer.send("polyask:set-surface", value),
  setSelection: (sites: readonly SiteKey[]) => invoke("polyask:set-selection", sites),
  setParticipation: (sites: readonly SiteKey[]) => invoke('polyask:set-participation', sites),
  setTier: (value: BroadcastRequest["tier"]) => invoke("polyask:set-tier", value),
  saveGroup: (input: { readonly name: string; readonly sites: readonly SiteKey[] }) =>
    invoke("polyask:save-group", input),
  deleteGroup: (id: string) => invoke("polyask:delete-group", id),
  newSession: (sites: readonly SiteKey[]) => invoke("polyask:new-session", sites),
  showGroupMenu: () => invoke("polyask:show-group-menu"),
  showCommandMenu: (commands: readonly CommandId[]) => invoke("polyask:show-command-menu", commands),
  setCompletionNotifications: (enabled: boolean) =>
    ipcRenderer.send("polyask:set-completion-notifications", enabled),
  savePromptTemplate: (input: Pick<PromptTemplate, "name" | "text">) =>
    invoke("polyask:prompt-template-save", input),
  deletePromptTemplate: (id: string) => invoke("polyask:prompt-template-delete", id),
  connectSync: () => invoke("polyask:sync-connect"),
  syncNow: () => invoke("polyask:sync-now"),
  setImageSyncEnabled: (enabled: boolean, confirmed?: boolean) => invoke("polyask:sync-images", enabled, confirmed),
  questionFetchAttachments: (id: string) => invoke("polyask:question-fetch-attachments", id),
  disconnectSync: () => invoke("polyask:sync-disconnect"),
  clearRemoteSync: (confirmation: string) => invoke("polyask:sync-clear", confirmation),
  syncDiagnostics: () => invoke("polyask:sync-diagnostics"),
  checkSiteHealth: (sites: readonly SiteKey[]) => invoke("polyask:site-health", sites),
  getRuntimeProcessFailures: () => invoke("polyask:runtime-process-failures"),
  getCaptureLocateCounts: () => invoke("polyask:capture-locate-counts"),
  reloadSite: (site: SiteKey, ignoreCache?: boolean) => invoke("polyask:reload-site", site, ignoreCache),
  clearSiteData: (site: SiteKey) => invoke("polyask:clear-site-data", site),
  clearHistory: () => invoke("polyask:clear-history"),
  clearDecisions: () => invoke("polyask:clear-decisions"),
  clearArchives: () => invoke("polyask:clear-archives"),
  resetLocalData: () => invoke("polyask:reset-local"),
  onStatus: (listener: (status: SiteStatus) => void) => subscribe("polyask:site-status", listener),
  onLayout: (listener: (layout: LayoutState) => void) => subscribe("polyask:layout", listener),
  onDisplayPreferences: (listener: (value: DisplayPreferences) => void) =>
    subscribe("polyask:display-preferences", listener),
  onCommand: (listener: (id: CommandId) => void) => subscribe("polyask:command", listener),
  onWorkspaceState: (listener: (value: WorkspaceState) => void) =>
    subscribe("polyask:workspace-state", listener),
  onPromptLibrary: (listener: (value: PromptLibraryState) => void) =>
    subscribe("polyask:prompt-library", listener),
  onSyncStatus: (listener: (value: SyncStatus) => void) => subscribe("polyask:sync-status", listener),
  getProxyState: (request?: ProxyStateRequest) => invoke("polyask:proxy-state", request),
  saveProxy: (request: ProxySetRequest) => invoke("polyask:proxy-set", request),
  followProxy: (enabled: boolean) => invoke("polyask:proxy-follow", { enabled }),
  acceptProxy: (request: ProxyAcceptRequest) => invoke("polyask:proxy-accept", request),
  testProxy: (request: ProxyTestRequest) => invoke("polyask:proxy-test", request),
  reloadProxySites: () => invoke("polyask:proxy-reload-sites"),
  onProxyState: (listener: (value: ProxyStateView) => void) => subscribe("polyask:proxy-state-changed", listener)
});

contextBridge.exposeInMainWorld("polyask", api);
