import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BackupPreview } from "../shared/backup";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { formatDateTime } from "../shared/format";
import { ipcErrorCode } from "../shared/ipc-error";
import { BackupComparison, backupKind, eligibleBackupSelection, initialBackupSelection } from "./backup-comparison";
import { registerDecisionNavigationGuard } from "./decision-navigation";
import { shell } from "./shell-api";

export function backupError(copy: DesktopCopy, error: unknown): string {
  const code = ipcErrorCode(error);
  if (code === "backup_stale" || code === "backup_missing") return copy.backupStale;
  if (code === "backup_invalid" || code === "backup_version") return copy.backupInvalid;
  if (code === "backup_too_large") return copy.backupTooLarge;
  return copy.backupFailed;
}

export function BackupWorkspace({ preview, copy, locale, onClose, onApplied }: {
  preview: BackupPreview; copy: DesktopCopy; locale: string; onClose: () => void; onApplied: (message: string) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(() => initialBackupSelection(preview.items));
  const [activeKey, setActiveKey] = useState(preview.items[0]?.key);
  const [filter, setFilter] = useState("all");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const locked = useRef(false);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const confirmingRef = useRef(confirming); confirmingRef.current = confirming;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!locked.current) { if (confirmingRef.current) setConfirming(false); else onCloseRef.current(); }
      }
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!controls?.length) { event.preventDefault(); panel.current?.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      const inside = document.activeElement instanceof Node && panel.current?.contains(document.activeElement);
      if (!inside || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("keydown", keydown, true); opener?.focus(); };
  }, []);
  useEffect(() => registerDecisionNavigationGuard((action) => {
    if (locked.current) return;
    onCloseRef.current(); action();
  }), []);
  useEffect(() => { cancel.current?.focus(); }, [confirming]);
  const visible = preview.items.filter((item) => filter === "all" || item.kind === filter);
  const active = visible.find((item) => item.key === activeKey) ?? visible[0];
  const eligible = eligibleBackupSelection(preview.items, selected);
  const summary = formatCopy(copy.backupSummary, { count: eligible.size, skipped: preview.items.length - eligible.size });
  const apply = async () => {
    if (locked.current) return;
    locked.current = true; setApplying(true); setError("");
    try {
      const result = await shell.applyBackup(preview.token, [...selected]);
      onApplied(formatCopy(copy.backupCompleted, { count: result.imported, skipped: result.skipped }));
    } catch (reason) { setError(backupError(copy, reason)); setConfirming(false); }
    finally { locked.current = false; setApplying(false); }
  };
  return createPortal(<div className="backup-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); panel.current?.focus(); } }}>
    <div className="backup-workspace" role="dialog" aria-modal="true" aria-labelledby="backup-review-title" tabIndex={-1} ref={panel} aria-busy={applying}>
      <header className="backup-header"><div><h2 id="backup-review-title">{confirming ? copy.backupConfirmTitle : copy.backupReview}</h2>{preview.filename ? <p className="backup-filename">{preview.filename}</p> : null}<p>{formatCopy(copy.backupDate, { date: formatDateTime(preview.exportedAt, locale) })}</p></div><button type="button" disabled={applying} ref={cancel} onClick={() => confirming ? setConfirming(false) : onClose()}>{copy.cancel}</button></header>
      {error ? <p role="alert" className="backup-error">{error}</p> : null}
      {confirming ? <section className="backup-summary"><h3>{summary}</h3><p>{copy.backupSyncNotice}</p><ul>{preview.items.filter((item) => eligible.has(item.key)).map((item) => <li key={item.key}>{backupKind(copy, item.kind)} · {item.title}{item.status === "deleted" ? ` · ${copy.backupRestoreDeleted}` : ""}</li>)}</ul></section> : <>
        <nav className="backup-filters" aria-label={copy.backupAll}>{["all", ...new Set(preview.items.map((item) => item.kind))].map((kind) => <button key={kind} type="button" aria-pressed={filter === kind} onClick={() => setFilter(kind)}>{kind === "all" ? copy.backupAll : backupKind(copy, kind)}</button>)}</nav>
        <div className="backup-body"><nav className="backup-list" aria-label={copy.backupReview}>{visible.map((item) => <button type="button" key={item.key} aria-current={active?.key === item.key ? "true" : undefined} onClick={() => setActiveKey(item.key)}><strong>{item.title}</strong><span>{backupKind(copy, item.kind)} · {item.status === "new" ? copy.backupNew : item.status === "same" ? copy.backupSame : item.status === "conflict" ? copy.backupConflict : copy.backupDeleted}</span><small>{item.note === "folder_reused" && selected.has(item.key) ? copy.backupReuseFolder : eligible.has(item.key) ? copy.backupInclude : item.status === "conflict" ? copy.backupKeepLocal : copy.backupSkipped}</small></button>)}</nav>
          {active ? <BackupComparison copy={copy} item={active} selected={selected.has(active.key)} onSelect={(value) => setSelected((before) => { const next = new Set(before); if (value) next.add(active.key); else next.delete(active.key); return next; })} /> : <p>{copy.backupEmpty}</p>}
        </div>
      </>}
      <footer className="backup-footer"><div><strong>{summary}</strong><p>{copy.backupSyncNotice}</p></div><button type="button" className="primary" disabled={applying || eligible.size === 0 || !!error} onClick={() => confirming ? void apply() : setConfirming(true)}>{applying ? copy.backupApplying : confirming ? copy.backupConfirm : copy.backupReviewSummary}</button></footer>
    </div>
  </div>, document.body);
}

export function BackupCard({ copy, locale, busy, onBusy, onFeedback }: {
  copy: DesktopCopy; locale: string; busy: boolean; onBusy: (busy: boolean) => void; onFeedback: (message: string) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const tokenRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (tokenRef.current) void shell.cancelBackup(tokenRef.current).catch(() => undefined); }; }, []);
  const close = () => { const token = tokenRef.current; tokenRef.current = null; setPreview(null); if (token) void shell.cancelBackup(token).catch(() => undefined); };
  const run = async (action: "export" | "import") => {
    if (busy || pending.current) return;
    pending.current = true; onBusy(true);
    try {
      if (action === "export") { if (await shell.exportBackup() && mounted.current) onFeedback(copy.backupExported); }
      else { const next = await shell.previewBackup(); if (!mounted.current) { if (next) await shell.cancelBackup(next.token); return; } tokenRef.current = next?.token ?? null; setPreview(next); }
    } catch (error) { if (mounted.current) onFeedback(backupError(copy, error)); }
    finally { pending.current = false; if (mounted.current) onBusy(false); }
  };
  return <section className="settings-card" aria-labelledby="backup-card-title"><h2 id="backup-card-title">{copy.backupTitle}</h2><p>{copy.backupDescription}</p><div className="settings-actions"><button type="button" disabled={busy} onClick={() => void run("export")}>{copy.backupExport}</button><button type="button" disabled={busy} onClick={() => void run("import")}>{copy.backupImport}</button></div>{preview ? <BackupWorkspace preview={preview} copy={copy} locale={locale} onClose={close} onApplied={(message) => { close(); onFeedback(message); }} /> : null}</section>;
}
