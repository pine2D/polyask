import { useEffect, useRef, useState } from "react";

import type { DesktopCopy } from "../shared/copy";
import { formatCopy } from "../shared/copy";
import { CLEAR_REMOTE_CONFIRMATION, type SyncStatus } from "../shared/sync";
import {
  buildSyncDiagnosticReport,
  createSyncDiagnosticSnapshot,
  firstFailedSyncStage,
  type SyncDiagnosticSnapshot
} from "../shared/sync-diagnostics";
import type { RuntimeInfo } from "../shared/runtime";
import type { DisplayPreferences } from "../shared/display";
import { CloseIcon } from "./icons";
import { BackupCard } from "./backup-workspace";
import { LocalDataCard } from "./local-data-card";
import { SettingsDisplay } from "./settings-display";
import { SyncDiagnosticsPanel } from "./sync-diagnostics-panel";
import { describeSync } from "./sync-status";
import { shell } from "./shell-api";

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
  readonly display?: DisplayPreferences;
  readonly onDisplayChange?: (preferences: DisplayPreferences) => Promise<void>;
  readonly initialSection?: "overview" | "drive-diagnostics" | "data" | "display";
  readonly sectionRequest?: number;
  readonly onLocalReset?: () => void;
  readonly onBlockingChange?: (blocking: boolean) => void;
}

type SyncAction = () => Promise<SyncStatus>;

export function SettingsWorkspace(props: SettingsWorkspaceProps): React.JSX.Element {
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pendingAction, setPendingAction] = useState<"sync" | "connect" | "clear" | "other" | null>(null);
  const [feedback, setFeedback] = useState("");
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
  const [backupRequest, setBackupRequest] = useState(0);
  // Only a destructive write may hold the page hostage; waiting on browser
  // authorization (up to five minutes) must never lock the exit.
  const closeLocked = clearingCloud || localWriting;
  const writes = useRef({ local: false, cloud: false });
  const pendingFocus = useRef(false);
  const busy = actionBusy || props.status.state === "syncing";
  const statusText = describeSync(props.copy, props.status);
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
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && !closeLocked) props.onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeLocked, props.onClose]);
  useEffect(() => {
    setDiagnostics(createSyncDiagnosticSnapshot(props.status, props.runtime));
  }, [props.runtime, props.status]);
  useEffect(() => {
    const section = props.initialSection;
    if (section === "data") setDataOpen(true);
    if (section === "drive-diagnostics") setDiagnosticsOpen(true);
    const id = section === "data" ? "settings-advanced-toggle" : section === "display" ? "settings-display-title"
      : section === "drive-diagnostics" ? "sync-diagnostics-toggle" : null;
    if (id) queueMicrotask(() => { const target = document.getElementById(id); target?.scrollIntoView({ block: "nearest" }); target?.focus(); });
  }, [props.initialSection, props.sectionRequest]);
  useEffect(() => {
    if (!backupRequest) return;
    const target = document.querySelector<HTMLButtonElement>('section[aria-labelledby="backup-card-title"] button');
    target?.scrollIntoView({ block: "nearest" }); target?.focus();
  }, [backupRequest]);
  useEffect(() => {
    // Background status pushes update the panel; only an explicit action moves focus.
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const failed = diagnosticsOpen ? firstFailedSyncStage(diagnostics) : null;
    if (failed) queueMicrotask(() => document.getElementById(`sync-stage-${failed.id}`)?.focus());
  }, [diagnostics, diagnosticsOpen]);
  const lastSuccess = props.status.lastSuccessAt
    ? formatCopy(props.copy.syncLastSuccess, {
      time: new Intl.DateTimeFormat(props.locale, { dateStyle: "short", timeStyle: "short" })
        .format(props.status.lastSuccessAt)
    })
    : props.copy.syncNever;
  const run = async (action: SyncAction, kind: "sync" | "connect" | "clear" | "other" = "other"): Promise<void> => {
    if (busy) return;
    setPendingAction(kind);
    setActionBusy(true);
    try {
      const next = await action();
      pendingFocus.current = true;
      if (firstFailedSyncStage(createSyncDiagnosticSnapshot(next, props.runtime))) setDiagnosticsOpen(true);
      props.onStatus(next);
      const message = describeSync(props.copy, next);
      setFeedback(message);
      props.onAnnounce(message);
    } catch {
      setFeedback(props.copy.syncActionFailed);
      props.onAnnounce(props.copy.syncActionFailed);
    } finally {
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
        setFeedback(props.copy.syncDiagnosticsRefreshFailed);
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
      setFeedback(props.copy.syncDiagnosticsCopied);
      props.onAnnounce(props.copy.syncDiagnosticsCopied);
    } catch {
      setFeedback(props.copy.syncDiagnosticsCopyFailed);
      props.onAnnounce(props.copy.syncDiagnosticsCopyFailed);
    }
  };
  const checkUpdates = async (): Promise<void> => {
    if (busy || !props.onCheckUpdates) return;
    setActionBusy(true);
    try {
      await props.onCheckUpdates();
      setFeedback(props.copy.updatePageOpened);
      props.onAnnounce(props.copy.updatePageOpened);
    } catch {
      setFeedback(props.copy.updatePageFailed);
      props.onAnnounce(props.copy.updatePageFailed);
    } finally {
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
        <div className="settings-group">
          <section className="settings-card sync-overview" aria-labelledby="sync-title">
            <div className="settings-description">
              <h1 id="sync-title">{props.copy.syncTitle}</h1>
              <p>{props.copy.syncDescription}</p>
            </div>
            <div className="sync-state" data-state={props.status.state} data-connected={props.status.connected}>
              <i aria-hidden="true" />
              <strong>{props.status.connected ? props.copy.syncConnected : props.copy.syncDisconnected}</strong>
              <span>{statusText}</span>
            </div>
            <dl className="sync-facts">
              <div><dt>{formatCopy(props.copy.syncPending, { count: props.status.pending })}</dt><dd>{lastSuccess}</dd></div>
            </dl>
            {!props.status.oauthConfigured ? <p className="settings-notice danger" role="alert">{props.copy.syncOauthMissing}</p> : null}
            {props.status.oauthConfigured && !props.status.secureTokenStorage ? <p className="settings-notice warning">{props.copy.syncStorageWarning}</p> : null}
            {props.status.readOnly ? <p className="settings-notice warning">{props.copy.syncReadOnly}</p> : null}
            <div className="settings-actions">
              {!props.status.connected || props.status.state === "auth" ? (
                <button type="button" className="settings-control primary" disabled={busy || !props.status.oauthConfigured} onClick={() => void run(() => shell.connectSync(), "connect")}>{props.copy.syncConnect}</button>
              ) : <button type="button" className="settings-control primary" disabled={busy} onClick={() => void run(() => shell.syncNow(), "sync")}>{props.status.state === "syncing" ? statusText : pendingAction === "sync" ? props.copy.syncStateSyncing : props.copy.syncNow}</button>}
              {props.status.connected ? <button type="button" className="settings-control" disabled={busy} onClick={() => void run(() => shell.disconnectSync())}>{props.copy.syncDisconnect}</button> : null}
              {!props.status.connected && props.status.hasStoredToken ? (
                <button type="button" className="settings-control" title={props.copy.syncRevokeHint} disabled={busy} onClick={() => void run(() => shell.disconnectSync())}>{props.copy.syncRevoke}</button>
              ) : null}
            </div>
            <SyncDiagnosticsPanel
              copy={props.copy}
              snapshot={diagnostics}
              open={diagnosticsOpen}
              busy={busy || diagnosticsBusy}
              refreshing={diagnosticsBusy}
              canSync={props.status.connected && props.status.state !== "auth"}
              onOpenChange={setDiagnosticsOpen}
              onCopy={() => { void copyDiagnostics(); }}
              onRefresh={() => { void refreshDiagnostics(); }}
              onSync={() => { void run(() => shell.syncNow(), "sync"); }}
            />
            <p className="sync-privacy">{props.copy.syncPrivacy}</p>
          </section>
          <BackupCard copy={props.copy} locale={props.locale} busy={busy} onBusy={setActionBusy} onFeedback={(message) => { setFeedback(message); props.onAnnounce(message); }} />
          <SettingsDisplay copy={props.copy} display={props.display} busy={busy} onChange={props.onDisplayChange} />
          <label className="settings-card preference-card">
            <span className="preference-copy">
              <strong id="completion-notifications-title" className="preference-title">{props.copy.completionNotifications}</strong>
              <p>{props.copy.completionNotificationsDescription}</p>
              <small>{props.copy.localPreference}</small>
            </span>
            <span className="preference-switch">
              <input
                type="checkbox"
                name="completion-notifications"
                aria-labelledby="completion-notifications-title"
                checked={!!props.completionNotifications}
                onChange={(event) => props.onCompletionNotificationsChange?.(event.target.checked)}
              />
              <span aria-hidden="true" />
            </span>
          </label>
          <section className="settings-card settings-row update-card" aria-labelledby="app-updates-title">
            <h2 id="app-updates-title">{props.copy.appUpdates}</h2>
            <p>{props.copy.appUpdatesDescription}</p>
            <button type="button" className="settings-control" disabled={busy || !props.onCheckUpdates} onClick={() => { void checkUpdates(); }}>{props.copy.checkForUpdates}</button>
          </section>
        </div>
        <details className="settings-group settings-data-group settings-advanced" open={dataOpen}>
          <summary id="settings-advanced-toggle" onClick={(event) => { event.preventDefault(); if (!clearingCloud && !localWriting) setDataOpen(value => !value); }}>{props.copy.settingsAdvancedData}</summary>
          <p className="settings-advanced-hint">{props.copy.settingsAdvancedHint}</p>
          <LocalDataCard
            copy={props.copy}
            busy={busy}
            onBusy={(value) => { setWriteBlocking("local", value); setActionBusy(value); }}
            onFeedback={(message) => { setFeedback(message); props.onAnnounce(message); }}
            onStatus={props.onStatus}
            onReset={props.onLocalReset}
            onBackup={() => setBackupRequest(value => value + 1)}
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
      </div>
      <footer className="archive-status" role="status" aria-live="polite">{progress || feedback}</footer>
    </main>
  );
}
