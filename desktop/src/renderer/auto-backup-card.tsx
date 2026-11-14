import { useCallback, useEffect, useRef, useState } from "react";

import type { AutoBackupSummary, BackupPreview } from "../shared/backup";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { formatDateTime } from "../shared/format";
import { BackupWorkspace, backupError } from "./backup-workspace";
import { useSettingsCategoryActive } from "./settings-category-panel";
import { shell } from "./shell-api";
import { useFailedActionFocus } from "./use-failed-action-focus";

function formatSnapshotSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AutoBackupCard({ copy, locale, busy, resetKey = 0, onBusy, onFeedback }: {
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly busy: boolean;
  readonly resetKey?: number;
  readonly onBusy: (busy: boolean) => void;
  readonly onFeedback: (message: string) => void;
}): React.JSX.Element {
  const categoryActive = useSettingsCategoryActive();
  const [items, setItems] = useState<readonly AutoBackupSummary[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const tokenRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const intent = useRef(0);
  const rememberFocus = useFailedActionFocus(busy);

  const loadList = useCallback(async (): Promise<void> => {
    if (typeof shell.listAutoBackups !== "function") return;
    try {
      const next = await shell.listAutoBackups();
      if (!mounted.current) return;
      setItems(Array.isArray(next) ? next : []);
      setLoadFailed(false);
    } catch {
      if (!mounted.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (tokenRef.current) void shell.cancelBackup(tokenRef.current).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList, resetKey, categoryActive]);

  const closePreview = (): void => {
    const token = tokenRef.current;
    tokenRef.current = null;
    setPreview(null);
    if (token) void shell.cancelBackup(token).catch(() => undefined);
  };

  const openRestore = async (id: string): Promise<void> => {
    if (busy || pending.current || typeof shell.previewAutoBackup !== "function") return;
    const request = ++intent.current;
    const finishFocus = rememberFocus();
    let failed = false;
    pending.current = true;
    onBusy(true);
    try {
      const next = await shell.previewAutoBackup(id);
      if (!mounted.current || request !== intent.current) {
        await shell.cancelBackup(next.token).catch(() => undefined);
        return;
      }
      tokenRef.current = next.token;
      setPreview(next);
    } catch (error) {
      if (mounted.current && request === intent.current) {
        failed = true;
        onFeedback(backupError(copy, error, "import"));
        void loadList();
      }
    } finally {
      finishFocus(failed);
      pending.current = false;
      if (mounted.current) onBusy(false);
    }
  };

  const exportCopy = async (id: string): Promise<void> => {
    if (busy || pending.current || typeof shell.exportAutoBackup !== "function") return;
    const request = ++intent.current;
    const finishFocus = rememberFocus();
    let failed = false;
    pending.current = true;
    onBusy(true);
    try {
      const result = await shell.exportAutoBackup(id);
      if (!mounted.current || request !== intent.current || !result) return;
      onFeedback(result === "text-only" ? copy.backupTextOnlyExported : copy.backupExported);
    } catch (error) {
      if (mounted.current && request === intent.current) {
        failed = true;
        onFeedback(backupError(copy, error, "export"));
      }
    } finally {
      finishFocus(failed);
      pending.current = false;
      if (mounted.current) onBusy(false);
    }
  };

  return (
    <section className="settings-card auto-backup-card" aria-labelledby="auto-backup-title">
      <div className="auto-backup-heading">
        <h2 id="auto-backup-title">{copy.autoBackupTitle}</h2>
        <span className="auto-backup-retention">{copy.autoBackupBadge}</span>
      </div>
      <p>{copy.autoBackupDescription}</p>
      {loadFailed ? <p className="settings-notice warning">{copy.autoBackupLoadFailed}</p> : null}
      {!loadFailed && items.length === 0 ? (
        <div className="auto-backup-empty" data-auto-backup-empty>
          <strong>{copy.autoBackupEmptyTitle}</strong>
          <span>{copy.autoBackupEmptyHint}</span>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="auto-backup-list" aria-labelledby="auto-backup-title">
          {items.map((item) => {
            const label = item.fromVersion
              ? formatCopy(copy.autoBackupTransition, { from: item.fromVersion, to: item.toVersion })
              : formatCopy(copy.autoBackupBeforeVersion, { to: item.toVersion });
            return (
              <li key={item.id} className="auto-backup-item" data-auto-backup-id={item.id}>
                <div className="auto-backup-meta">
                  <div className="auto-backup-title-row">
                    <strong className="auto-backup-version">{label}</strong>
                    {item.textOnly ? <span className="auto-backup-tag">{copy.autoBackupTextOnlyTag}</span> : null}
                  </div>
                  <span className="auto-backup-facts">
                    {formatDateTime(item.createdAt, locale)} · {formatSnapshotSize(item.sizeBytes)}
                  </span>
                </div>
                <div className="settings-actions auto-backup-actions">
                  <button
                    type="button"
                    className="settings-control"
                    disabled={busy}
                    onClick={() => { void openRestore(item.id); }}
                  >
                    {copy.autoBackupRestore}
                  </button>
                  <button
                    type="button"
                    className="settings-control"
                    disabled={busy}
                    onClick={() => { void exportCopy(item.id); }}
                  >
                    {copy.autoBackupExport}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {preview ? (
        <BackupWorkspace
          preview={preview}
          copy={copy}
          locale={locale}
          onClose={closePreview}
          onApplied={(message) => { closePreview(); onFeedback(message); }}
        />
      ) : null}
    </section>
  );
}
