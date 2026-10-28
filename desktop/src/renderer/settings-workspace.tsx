import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DesktopCopy } from "../shared/copy";
import { formatCopy } from "../shared/copy";
import { formatDateTime } from "../shared/format";
import { CLEAR_REMOTE_CONFIRMATION, type SyncStatus } from "../shared/sync";
import {
  buildSyncDiagnosticReport,
  createSyncDiagnosticSnapshot,
  firstFailedSyncStage,
  type SyncDiagnosticSnapshot
} from "../shared/sync-diagnostics";
import type { RuntimeInfo } from "../shared/runtime";
import type { DisplayPreferences } from "../shared/display";
import type { ConfirmationKey } from "../shared/preferences";
import { CloseIcon } from "./icons";
import { BackupCard } from "./backup-workspace";
import { LocalDataCard } from "./local-data-card";
import { SettingsDisplay } from "./settings-display";
import { SettingsLayout } from './settings-layout';
import { PreferenceSyncSettings } from "./preference-sync-settings";
import { SettingsConfirmations } from "./settings-confirmations";
import { SettingsProxy } from "./settings-proxy";
import { useProxyState } from "./use-proxy-state";
import type { PreferenceSyncSettingsState } from "./use-synced-preferences";
import { SyncDiagnosticsPanel } from "./sync-diagnostics-panel";
import { describeSync } from "./sync-status";
import { syncNeedsReauthorization, syncOverview } from "./sync-overview";
import { shell } from "./shell-api";
import { SettingsImageSync } from "./settings-image-sync";
import { useSettingsSectionNavigation } from "./settings-section-navigation";
import { SettingsCategoryPanel } from './settings-category-panel';
import { SETTINGS_CATEGORIES, settingsCategoryLabels, resolveSettingsTarget, type SettingsCategory, type SettingsTarget, type SettingsNavigationTarget } from './settings-categories';
import { NotificationSettings } from './notification-settings';
import { SettingsCommandPaletteShortcut } from './settings-command-palette-shortcut';
import { isMac } from './platform';
import { SettingsGlobalPromptShortcut } from './settings-global-prompt-shortcut';

interface SettingsWorkspaceProps {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly status: SyncStatus;
  readonly runtime: RuntimeInfo;
  readonly onStatus: (value: SyncStatus) => void;
  readonly onAnnounce: (value: string) => void;
  readonly onClose: () => void;
  readonly onCheckUpdates?: () => void | Promise<void>;
  readonly completionNotifications?: boolean;
  readonly onCompletionNotificationsChange?: (enabled: boolean) => void;
  readonly confirmations?: Readonly<Record<ConfirmationKey, boolean>>;
  readonly onConfirmationChange?: (key: ConfirmationKey, enabled: boolean) => void;
  readonly display?: DisplayPreferences;
  readonly onDisplayChange?: (preferences: DisplayPreferences) => Promise<void>;
  readonly preferenceSync?: PreferenceSyncSettingsState;
  readonly initialSection?: SettingsTarget;
  readonly onOpenShortcuts?: () => void;
  readonly onOpenGuide?: () => void;
  readonly operationBusy?: boolean; // 群发、综合、新会话、站点参与切换进行中：代理写操作须经 OperationGate，此时禁用（spec §3.4、§6.2）
  readonly sectionRequest?: number;
  readonly onLocalReset?: () => void;
  readonly onBlockingChange?: (blocking: boolean) => void;
}

type SyncAction = () => Promise<SyncStatus>;

export function SettingsWorkspace(props: SettingsWorkspaceProps): React.JSX.Element {
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pendingAction, setPendingAction] = useState<"sync" | "connect" | "clear" | "other" | null>(null);
  const [feedback, setFeedbackState] = useState<Partial<Record<SettingsCategory, string>>>({});
  const setFeedback = (category: SettingsCategory, message: string) => setFeedbackState(before => ({ ...before, [category]: message }));
  const [diagnostics, setDiagnostics] = useState<SyncDiagnosticSnapshot>(() =>
    createSyncDiagnosticSnapshot(props.status, props.runtime)
  );
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(() =>
    props.initialSection === "drive-diagnostics"
      || firstFailedSyncStage(createSyncDiagnosticSnapshot(props.status, props.runtime)) !== null
  );
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [clearingCloud, setClearingCloud] = useState(false);
  const [dataOpen, setDataOpen] = useState(() => props.initialSection === "data");
  const [localWriting, setLocalWriting] = useState(false);
  const [localResetRevision, setLocalResetRevision] = useState(0);
  // Only a destructive write may hold the page hostage; waiting on browser
  // authorization (up to five minutes) must never lock the exit.
  const closeLocked = clearingCloud || localWriting;
  const { bodyRef, currentSection, navigate } = useSettingsSectionNavigation(props.initialSection, props.sectionRequest, closeLocked);
  const writes = useRef({ local: false, cloud: false });
  const actionInFlight = useRef(false);
  const pendingFocus = useRef(false);
  const busy = actionBusy || props.status.state === "syncing";
  const proxy = useProxyState({ secret: true }); // 全仓唯一带密码读取标志的调用：设置卡与同步行共用这一个句柄
  const statusText = describeSync(props.copy, props.status);
  const overview = syncOverview(props.copy, props.status);
  const setWriteBlocking = (source: "local" | "cloud", value: boolean): void => {
    const wasBlocking = writes.current.local || writes.current.cloud;
    writes.current[source] = value;
    const blocking = writes.current.local || writes.current.cloud;
    // Notify the command gate synchronously, before the destructive IPC starts.
    if (blocking !== wasBlocking) props.onBlockingChange?.(blocking);
    if (source === "local") setLocalWriting(value); else setClearingCloud(value);
  };
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && !closeLocked) { event.preventDefault(); props.onClose(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeLocked, props.onClose]);
  useEffect(() => {
    setDiagnostics(createSyncDiagnosticSnapshot(props.status, props.runtime));
  }, [props.runtime, props.status]);
  useLayoutEffect(() => {
    if (writes.current.local || writes.current.cloud) return;
    if (props.initialSection === 'data') setDataOpen(true);
    if (props.initialSection === 'drive-diagnostics') setDiagnosticsOpen(true);
  }, [props.initialSection, props.sectionRequest]);
  useEffect(() => { if (currentSection !== 'data') setConfirmation(''); }, [currentSection]);
  useEffect(() => {
    // Background status pushes update the panel; only an explicit action moves focus.
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const failed = diagnosticsOpen ? firstFailedSyncStage(diagnostics) : null;
    if (failed) queueMicrotask(() => {
      const target = document.getElementById(`sync-stage-${failed.id}`);
      if (target && !target.closest('[hidden],[inert]')) target.focus();
    });
  }, [diagnostics, diagnosticsOpen]);
  const lastSuccess = props.status.lastSuccessAt
    ? formatCopy(props.copy.syncLastSuccess, {
      time: formatDateTime(props.status.lastSuccessAt, props.locale)
    })
    : props.copy.syncNever;
  const run = async (action: SyncAction, kind: "sync" | "connect" | "clear" | "other" = "other"): Promise<void> => {
    if (actionInFlight.current || busy || writes.current.local) return;
    actionInFlight.current = true;
    setPendingAction(kind);
    setActionBusy(true);
    try {
      const next = await action();
      pendingFocus.current = true;
      if (firstFailedSyncStage(createSyncDiagnosticSnapshot(next, props.runtime))) setDiagnosticsOpen(true);
      props.onStatus(next);
      const message = describeSync(props.copy, next);
      setFeedback(kind === "clear" ? "data" : "sync", message);
      props.onAnnounce(message);
    } catch {
      setFeedback(kind === "clear" ? "data" : "sync", props.copy.syncActionFailed);
      props.onAnnounce(props.copy.syncActionFailed);
    } finally {
      actionInFlight.current = false;
      setPendingAction(null);
      setActionBusy(false);
    }
  };
  const refreshDiagnostics = async (announceFailure = true): Promise<void> => {
    if (diagnosticsBusy) return;
    if (announceFailure) pendingFocus.current = true;
    setDiagnosticsBusy(true);
    try {
      const next = await shell.syncDiagnostics();
      setDiagnostics(next);
      if (firstFailedSyncStage(next)) setDiagnosticsOpen(true);
    } catch {
      if (announceFailure) {
        setFeedback("sync", props.copy.syncDiagnosticsRefreshFailed);
        props.onAnnounce(props.copy.syncDiagnosticsRefreshFailed);
      }
    } finally {
      setDiagnosticsBusy(false);
    }
  };
  useEffect(() => { void refreshDiagnostics(false); }, []);
  const copyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildSyncDiagnosticReport(diagnostics));
      setFeedback("sync", props.copy.syncDiagnosticsCopied);
      props.onAnnounce(props.copy.syncDiagnosticsCopied);
    } catch {
      setFeedback("sync", props.copy.syncDiagnosticsCopyFailed);
      props.onAnnounce(props.copy.syncDiagnosticsCopyFailed);
    }
  };
  const checkUpdates = async (): Promise<void> => {
    if (actionInFlight.current || busy || writes.current.local || writes.current.cloud || !props.onCheckUpdates) return;
    actionInFlight.current = true;
    setActionBusy(true);
    try {
      await props.onCheckUpdates();
      setFeedback("about", props.copy.updatePageOpened);
      props.onAnnounce(props.copy.updatePageOpened);
    } catch {
      setFeedback("about", props.copy.updatePageFailed);
      props.onAnnounce(props.copy.updatePageFailed);
    } finally {
      actionInFlight.current = false;
      setActionBusy(false);
    }
  };

  const cloudDisabled = clearingCloud || busy || !props.status.connected
    || props.status.state === "auth" || confirmation !== CLEAR_REMOTE_CONFIRMATION;
  const cloudBlocked = clearingCloud ? props.copy.syncClearing
    : busy ? props.copy.settingsWait
    : !props.status.connected ? props.copy.syncClearConnectFirst
    : props.status.state === "auth" ? props.copy.syncStateAuth
    : confirmation !== CLEAR_REMOTE_CONFIRMATION ? props.copy.syncClearInstruction : "";
  const progress = actionBusy ? pendingAction === "sync" ? props.copy.syncStateSyncing
    : pendingAction === "connect" ? props.copy.syncStateAuthorizing
    : pendingAction === "clear" ? props.copy.syncClearing : props.copy.settingsWorking
    : props.status.state === "syncing" ? statusText : "";
  const labels = settingsCategoryLabels(props.copy);
  const navigateSection = (target: SettingsNavigationTarget): void => {
    if (writes.current.local || writes.current.cloud) return;
    if (resolveSettingsTarget(target).category === 'data') setDataOpen(true);
    if (target === 'drive-diagnostics') setDiagnosticsOpen(true);
    navigate(target);
  };

  return (
    <main className="settings-workspace" aria-busy={busy}>
      <header className="settings-toolbar">
        <div className="settings-product">
          <strong>{props.copy.settings}</strong>
          <span>{formatCopy(props.copy.appVersion, {
            version: props.runtime.version,
            mode: props.runtime.distribution === "portable" ? props.copy.portableMode : props.copy.installedMode
          })}</span>
        </div>
        <button className="panel-close" type="button" title={props.copy.closeSettings} aria-label={props.copy.closeSettings} disabled={closeLocked} onClick={props.onClose}><CloseIcon /></button>
      </header>
      <div className="settings-body">
        <nav className="settings-section-navigation" aria-label={props.copy.settingsSectionNavigation}>
          <div className="settings-section-scroller">{SETTINGS_CATEGORIES.map(category => <button type="button" key={category} data-settings-section={category}
            aria-controls={`settings-category-${category}`} aria-current={currentSection === category ? 'location' : undefined}
            disabled={closeLocked} onClick={() => navigateSection({ category })}>{labels[category]}</button>)}</div>
          <select className="settings-category-select" aria-label={props.copy.settingsSectionNavigation} value={currentSection} disabled={closeLocked}
            onChange={event => navigateSection({ category: event.target.value as typeof currentSection })}>
            {SETTINGS_CATEGORIES.map(category => <option key={category} value={category}>{labels[category]}</option>)}
          </select>
        </nav>
        <div className="settings-grid" ref={bodyRef}>
        <SettingsCategoryPanel category="appearance" active={currentSection === 'appearance'} title={labels.appearance}>
          <SettingsDisplay copy={props.copy} display={props.display} busy={busy}
            following={props.preferenceSync?.snapshot?.following.display} onChange={props.onDisplayChange} />
          {props.preferenceSync ? <SettingsLayout {...props.preferenceSync} copy={props.copy} busy={busy} /> : null}
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="interaction" active={currentSection === 'interaction'} title={labels.interaction}>
          <NotificationSettings copy={props.copy} enabled={!!props.completionNotifications}
            busy={busy || closeLocked || (!!props.preferenceSync && !props.preferenceSync.snapshot)}
            preferenceHint={props.preferenceSync ? props.copy.preferenceSyncNotification : props.copy.localPreference}
            onChange={props.onCompletionNotificationsChange} onAnnounce={props.onAnnounce} />
          <SettingsCommandPaletteShortcut copy={props.copy} isMac={isMac} disabled={busy || closeLocked || !!props.operationBusy}
            resetKey={localResetRevision} onFeedback={props.onAnnounce} />
          <SettingsGlobalPromptShortcut copy={props.copy} disabled={busy || closeLocked || props.operationBusy}
            resetKey={localResetRevision} onFeedback={props.onAnnounce} />
          {props.confirmations && props.onConfirmationChange ? <SettingsConfirmations copy={props.copy} busy={busy || (!!props.preferenceSync && !props.preferenceSync.snapshot)}
            confirmations={props.confirmations} onChange={props.onConfirmationChange} /> : null}
          <div className="settings-card settings-actions">
            <button type="button" className="settings-control" disabled={closeLocked || !props.onOpenShortcuts} onClick={props.onOpenShortcuts}>{props.copy.keyboardShortcuts}</button>
            <button type="button" className="settings-control" disabled={closeLocked || !props.onOpenGuide} onClick={props.onOpenGuide}>{props.copy.gettingStarted}</button>
          </div>
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="sync" active={currentSection === 'sync'} title={labels.sync}>
          <section className="settings-card sync-overview" aria-labelledby="sync-title">
            <div className="settings-description">
              <h2 id="sync-title">{props.copy.syncTitle}</h2>
              <p>{props.copy.syncDescription}</p>
            </div>
            <div className="sync-state" data-state={props.status.state} data-connected={props.status.connected} data-tone={overview.tone}>
              <i aria-hidden="true" />
              <strong>{overview.title}</strong>
              <span>{overview.detail}</span>
            </div>
            <dl className="sync-facts">
              <div><dt>{formatCopy(props.copy.syncPending, { count: props.status.pending })}</dt><dd>{lastSuccess}</dd></div>
            </dl>
            {!props.status.oauthConfigured ? <p className="settings-notice danger" role="alert">{props.copy.syncOauthMissing}</p> : null}
            {props.status.oauthConfigured && !props.status.secureTokenStorage ? <p className="settings-notice warning">{props.copy.syncStorageWarning}</p> : null}
            {props.status.readOnly ? <p className="settings-notice warning">{props.copy.syncReadOnly}</p> : null}
            <div className="settings-actions">
              {overview.primary !== "sync" ? (
                <button type="button" className="settings-control primary" disabled={busy || !props.status.oauthConfigured} onClick={() => void run(() => shell.connectSync(), "connect")}>{overview.primaryLabel}</button>
              ) : <button type="button" className="settings-control primary" disabled={busy} onClick={() => void run(() => shell.syncNow(), "sync")}>{pendingAction === "sync" ? props.copy.syncStateSyncing : overview.primaryLabel}</button>}
              {props.status.connected ? <button type="button" className="settings-control" disabled={busy} onClick={() => void run(() => shell.disconnectSync())}>{props.copy.syncDisconnect}</button> : null}
              {!props.status.connected && props.status.hasStoredToken ? (
                <button type="button" className="settings-control" title={props.copy.syncRevokeHint} disabled={busy} onClick={() => void run(() => shell.disconnectSync())}>{props.copy.syncRevoke}</button>
              ) : null}
            </div>
            <SettingsImageSync copy={props.copy} status={props.status} blocked={closeLocked} onStatus={props.onStatus}
              onFeedback={message => { setFeedback("sync", message); props.onAnnounce(message); }} />
            <SyncDiagnosticsPanel
              copy={props.copy}
              snapshot={diagnostics}
              open={diagnosticsOpen}
              busy={busy || diagnosticsBusy}
              refreshing={diagnosticsBusy}
              canSync={props.status.connected && !syncNeedsReauthorization(props.status)}
              onOpenChange={setDiagnosticsOpen}
              onCopy={() => { void copyDiagnostics(); }}
              onRefresh={() => { void refreshDiagnostics(); }}
              onSync={() => { void run(() => shell.syncNow(), "sync"); }}
            />
            <p className="sync-privacy">{props.copy.syncPrivacy}</p>
          </section>
          {props.preferenceSync ? <PreferenceSyncSettings {...props.preferenceSync} proxy={proxy} copy={props.copy} busy={busy}
            onOpenLayout={() => navigateSection('layout')} /> : null}
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="backup" active={currentSection === 'backup'} title={labels.backup}>
          <BackupCard syncStatus={props.status} onOpenSync={target => navigateSection(target === 'connection' ? 'connection' : 'image-sync')}
            copy={props.copy} locale={props.locale} busy={busy} onBusy={setActionBusy} onFeedback={(message) => { setFeedback("backup", message); props.onAnnounce(message); }} />
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="network" active={currentSection === 'network'} title={labels.network}>
          <SettingsProxy copy={props.copy} proxy={proxy} busy={busy || !!props.operationBusy} onFeedback={(message) => { setFeedback("network", message); props.onAnnounce(message); }}
            onOpenSync={props.preferenceSync ? () => navigateSection('preference-sync') : undefined} />
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="about" active={currentSection === 'about'} title={labels.about}>
          <section className="settings-card settings-row update-card" aria-labelledby="app-updates-title">
            <div className="settings-description">
              <h2 id="app-updates-title">{props.copy.appUpdates}</h2>
              <p>{formatCopy(props.copy.currentAppVersion, { version: props.runtime.version })}</p>
              <p>{props.copy.appUpdatesDescription}</p>
            </div>
            <button type="button" className="settings-control" disabled={busy || !props.onCheckUpdates} onClick={() => { void checkUpdates(); }}>{props.copy.checkForUpdates}</button>
          </section>
        </SettingsCategoryPanel>
        <SettingsCategoryPanel category="data" active={currentSection === 'data'} title={labels.data}>
        <details className="settings-data-group settings-advanced" open={dataOpen}>
          <summary id="settings-advanced-toggle" onClick={(event) => { event.preventDefault(); if (!clearingCloud && !localWriting) setDataOpen(value => !value); }}>{props.copy.settingsAdvancedData}</summary>
          <p className="settings-advanced-hint">{props.copy.settingsAdvancedHint}</p>
          <LocalDataCard
            copy={props.copy}
            busy={busy}
            onBusy={(value) => { setWriteBlocking("local", value); setActionBusy(value); }}
            onFeedback={(message) => { setFeedback("data", message); props.onAnnounce(message); }}
            onStatus={props.onStatus}
            onReset={() => { setLocalResetRevision(value => value + 1); props.onLocalReset?.(); }}
            onBackup={() => navigateSection('backup-export')}
          />
          <section className="settings-card settings-row danger-zone cloud-data-row" aria-labelledby="clear-sync-title">
            <div className="settings-description">
              <h2 id="clear-sync-title">{props.copy.syncClearTitle}</h2>
              <p>{props.copy.syncClearDescription}</p>
            </div>
            <div className="cloud-data-controls">
              <label>
                <span>{props.copy.syncClearConfirmation}</span>
                <input aria-describedby={cloudBlocked ? "cloud-clear-hint" : undefined} name="clear-cloud-confirmation" value={confirmation} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
              <p id="cloud-clear-hint" className="settings-control-hint">{cloudBlocked}</p>
              <button
                className="settings-control"
                type="button"
                aria-describedby={cloudBlocked ? "cloud-clear-hint" : undefined}
                disabled={cloudDisabled}
                onClick={() => {
                  if (busy || writes.current.local || writes.current.cloud) return;
                  setWriteBlocking("cloud", true);
                  void run(async () => {
                    const next = await shell.clearRemoteSync(confirmation);
                    setConfirmation("");
                    return next;
                  }, "clear").finally(() => setWriteBlocking("cloud", false));
                }}
              >{clearingCloud ? props.copy.syncClearing : props.copy.syncClear}</button>
            </div>
          </section>
        </details>
        </SettingsCategoryPanel>
        </div>
      </div>
      <div className="archive-status" role="status" aria-live="polite">{progress || feedback[currentSection]}</div>
    </main>
  );
}
