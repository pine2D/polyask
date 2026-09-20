import { useEffect, useRef, useState } from "react";
import type { ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { DecisionInput, DecisionRecord, DecisionStatus } from "../shared/decision";
import { formatDateTime } from "../shared/format";
import { DecisionEditor, decisionInput, decisionStatuses, decisionStatusLabel, validDecisionDraft } from "./decision-editor";
import { ConfirmDialog } from "./confirm-dialog";
import { registerDecisionNavigationGuard, runApprovedDecisionNavigation } from "./decision-navigation";
import { LibraryMenu } from "./library-menu";
import { shell } from "./shell-api";

interface Props {
  readonly embedded?: boolean;
  readonly onBusy?: (busy: boolean) => void;
  readonly onOrganize?: () => void;
  readonly initialRecord?: DecisionRecord;
  readonly onChanged?: (record?: DecisionRecord) => void;
  readonly copy: DesktopCopy;
  readonly locale: string;
  readonly initialSource: ArchiveRecord | null;
  readonly onArchives: (source?: ArchiveRecord) => void;
  readonly onClose: () => void;
}

const newCard = (source: ArchiveRecord): DecisionInput => ({ archiveId: source.id,
  title: [...(source.task || source.text)].slice(0, 160).join(""), conclusion: "", rationale: "",
  uncertainties: "", nextStep: "", status: "draft", evidence: [] });

export function DecisionWorkspace({ copy, locale, initialSource, onArchives, onClose, embedded, initialRecord, onChanged, onOrganize, onBusy }: Props): React.JSX.Element {
  const [items, setItems] = useState<DecisionRecord[]>([]);
  const [saved, setSaved] = useState<DecisionRecord | null>(initialRecord ?? null);
  const [value, setValue] = useState<DecisionInput | null>(() => initialSource ? newCard(initialSource) : initialRecord ? decisionInput(initialRecord) : null);
  const [editing, setEditing] = useState(!!initialSource);
  const [source, setSource] = useState<ArchiveRecord | null | undefined>(initialSource ?? undefined);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DecisionStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<{ text: string; action: () => void } | null>(null);
  const [revision, setRevision] = useState(0);
  const searchEpoch = useRef(0);
  const busyRef = useRef(false);
  const dirty = editing && !!value && (!saved || JSON.stringify(value) !== JSON.stringify(decisionInput(saved)));
  const guard = (action: () => void) => {
    if (busyRef.current) return;
    if (dirty) setConfirmation({ text: copy.decisionDiscard, action: () => runApprovedDecisionNavigation(action) }); else action();
  };
  useEffect(() => registerDecisionNavigationGuard((action) => {
    if (busyRef.current) return;
    if (dirty) setConfirmation({ text: copy.decisionDiscard, action }); else action();
  }), [dirty, copy.decisionDiscard]);
  useEffect(() => {
    if (embedded) return;
    const epoch = ++searchEpoch.current;
    const timer = setTimeout(() => {
      setLoading(true);
      shell.searchDecisions({ query, status: filter }).then((records) => {
        if (searchEpoch.current === epoch) { setItems(records); setLoading(false); }
      }).catch(() => {
        if (searchEpoch.current === epoch) { setMessage(copy.decisionFailed); setLoading(false); }
      });
    }, query ? 180 : 0);
    return () => { clearTimeout(timer); searchEpoch.current++; };
  }, [query, filter, revision, copy.decisionFailed]);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setSourceFailed(false);
    if (value) shell.getArchive(value.archiveId).then((record) => { if (active) setSource(record); })
      .catch(() => { if (active) setSourceFailed(true); });
    return () => { active = false; };
  }, [value?.archiveId, revision]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try { await action(); } catch { setMessage(copy.decisionFailed); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const select = (record: DecisionRecord) => guard(() => {
    setSaved(record); setValue(decisionInput(record)); setEditing(false); setMessage("");
  });
  const save = () => {
    if (!value || !validDecisionDraft(value, source, saved)) { setMessage(copy.decisionValidation); return; }
    void run(async () => {
      const record = saved ? await shell.updateDecision(saved.id, value) : await shell.createDecision(value);
      setSaved(record); setValue(decisionInput(record)); setEditing(false); setRevision((count) => count + 1);
      setMessage(copy.decisionSaved); onChanged?.(record);
    });
  };
  const clearDetail = () => { setSaved(null); setValue(null); setEditing(false); setMessage(""); };
  const remove = () => {
    if (!saved) return;
    setConfirmation({ text: copy.decisionDeleteConfirm, action: () => { void run(async () => {
      await shell.deleteDecision(saved.id); clearDetail(); onChanged?.(); setRevision((count) => count + 1);
    }); } });
  };
  const exportCard = () => { if (saved) void run(async () => {
    const markdown = await shell.decisionMarkdown(saved.id, locale);
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `polyask-decision-${saved.id}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }); };
  return <section className="archive-workspace decision-workspace" aria-label={copy.decisionTitle} aria-busy={busy}>
    {!embedded ? <header className="archive-toolbar decision-toolbar">
      <nav className="decision-tabs" aria-label={copy.archiveTitle}>
        <button type="button" disabled={busy} onClick={() => guard(() => onArchives())}>{copy.decisionArchives}</button>
        <button type="button" aria-current="page">{copy.decisionTitle}</button>
      </nav>
      <div className="decision-filters">
        <input type="search" aria-label={copy.decisionSearch} placeholder={copy.decisionSearch} value={query} disabled={busy} onChange={(event) => { const next = event.target.value; guard(() => { clearDetail(); setQuery(next); }); }} />
        <select aria-label={copy.decisionStatus} value={filter} disabled={busy} onChange={(event) => { const next = event.target.value as DecisionStatus | ""; guard(() => { clearDetail(); setFilter(next); }); }}>
          <option value="">{copy.decisionAll}</option>{decisionStatuses.map((status) => <option key={status} value={status}>{decisionStatusLabel(copy, status)}</option>)}
        </select>
      </div>
      <button type="button" disabled={busy} onClick={() => guard(onClose)}>{copy.closeArchive}</button>
    </header> : null}
    <div className="archive-body">
      {!embedded ? <aside className="archive-list" aria-label={copy.decisionTitle}>
        {loading ? <p role="status">{copy.archiveLoading}</p> : !items.length ? <p>{copy.decisionEmpty}</p> : items.map((record) => <button type="button" key={record.id} aria-current={saved?.id === record.id ? "true" : undefined} disabled={busy} onClick={() => select(record)}>
          <time dateTime={new Date(record.updatedAt).toISOString()}>{formatDateTime(record.updatedAt, locale)}</time>
          <span>{record.title}</span><small>{decisionStatusLabel(copy, record.status)} · {record.sourceTitle}</small>
        </button>)}
      </aside> : null}
      <main className="archive-detail-pane">
        {value ? <>
          <div className="decision-detail-actions">
            <span className="library-record-kind">{copy.libraryCards}</span>
            <div className="library-decision-actions">
              {editing ? <>
                {dirty ? <span>{copy.decisionUnsaved}</span> : null}
                <button type="button" disabled={busy} onClick={() => guard(() => { if (saved) { setValue(decisionInput(saved)); setEditing(false); } else clearDetail(); })}>{copy.decisionCancel}</button>
                <button className="library-primary" type="button" disabled={busy} onClick={save}>{busy ? copy.librarySaving : copy.decisionSave}</button>
              </> : <>
                {onOrganize ? <button type="button" disabled={busy} onClick={onOrganize}>{copy.libraryOrganize}</button> : null}
                <button type="button" disabled={busy} onClick={() => setEditing(true)}>{copy.decisionEdit}</button>
                <LibraryMenu label={copy.libraryMore} disabled={busy} actions={[{ label: copy.decisionExport, run: exportCard }, { label: copy.decisionDelete, run: remove, danger: true }]} />
              </>}
            </div>
          </div>
          <DecisionEditor onOpenLink={url => { void run(() => shell.openExternal(url)); }} copy={copy} value={value} saved={saved} source={source} sourceFailed={sourceFailed} editing={editing} busy={busy} onChange={setValue} onOpenSource={() => guard(() => { if (source) onArchives(source); })} />
        </> : <div className="decision-placeholder">{items.length ? copy.decisionPick : copy.decisionEmpty}</div>}
      </main>
    </div>
    <div className="archive-status" role="status" aria-live="polite">{message}</div>
    {confirmation ? <ConfirmDialog copy={copy} title={copy.decisionTitle} message={confirmation.text}
      confirmLabel={copy.decisionConfirm} cancelLabel={copy.decisionCancel}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => { const action = confirmation.action; setConfirmation(null); action(); }} /> : null}
  </section>;
}
