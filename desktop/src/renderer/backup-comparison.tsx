import type { BackupPreviewItem } from "../shared/backup";
import type { DesktopCopy } from "../shared/copy";

export function initialBackupSelection(items: readonly BackupPreviewItem[]): Set<string> {
  return new Set(items.filter((item) => item.status === "new" && !item.blocked).map((item) => item.key));
}

export function eligibleBackupSelection(items: readonly BackupPreviewItem[], selected: ReadonlySet<string>): Set<string> {
  return new Set(items.filter((item) => selected.has(item.key) && item.note !== "folder_reused" && !item.blocked && (item.requires ?? []).every((key) => selected.has(key))).map((item) => item.key));
}

export function backupKind(copy: DesktopCopy, kind: string): string {
  const keys: Record<string, keyof DesktopCopy> = { question: "backupKindQuestion", questionAnswer: "backupKindQuestionAnswer", history: "backupKindHistory", archive: "backupKindArchive", decision: "backupKindDecision", folder: "backupKindFolder", folderMembership: "backupKindMembership", state: "backupKindState", template: "backupKindTemplate", group: "backupKindGroup", workspace: "backupKindWorkspace" };
  return copy[keys[kind] ?? "backupDetails"];
}

const FIELD_KEYS: Record<string, keyof DesktopCopy> = {
  questionId: "backupFieldId", site: "backupFieldSite", attempt: "backupFieldIndex", submission: "decisionStatus", capture: "decisionStatus", submissionCode: "backupFieldCode", captureCode: "backupFieldCode", answerMarkdown: "backupFieldAnswers", conversationUrl: "backupFieldUrl", requestedTier: "backupFieldTier", inputImageCount: "backupFieldIndex", sealedAt: "backupFieldTime",
  task: "archiveQuestion", text: "backupFieldValue", title: "decisionName", name: "decisionName", conclusion: "decisionConclusion", rationale: "decisionRationale", uncertainties: "decisionUncertainties", nextStep: "decisionNextStep", evidence: "decisionEvidence", status: "decisionStatus", note: "archiveNote", tags: "archiveTags",
  results: "backupFieldAnswers", source: "backupFieldSource", host: "backupFieldSite", label: "decisionName", excerpt: "backupFieldExcerpt", sites: "backupFieldSites", selectedSites: "backupFieldSites", tier: "backupFieldTier", id: "backupFieldId", schema: "backupFieldSchema", preview: "backupFieldPreview", resultPreviews: "backupFieldPreview", synthesis: "backupFieldSynthesis", instruction: "backupFieldInstruction", capturedAt: "backupFieldTime", createdAt: "backupFieldTime", updatedAt: "backupFieldTime", lastUsedAt: "backupFieldTime", ts: "backupFieldTime", url: "backupFieldUrl", kind: "backupFieldKind", targetKind: "backupFieldKind", code: "backupFieldCode", state: "decisionStatus", truncated: "backupFieldTruncated", resultIndex: "backupFieldIndex", favorite: "backupFieldFavorite", folderId: "backupFieldFolder", targetId: "backupFieldTarget", archiveId: "decisionSource", sourceTitle: "decisionSource", hosts: "backupFieldSites", winnerHost: "archiveBestAnswer", textHash: "backupFieldHash", searchText: "backupFieldPreview"
};

function BusinessData({ value, copy }: { value: unknown; copy: DesktopCopy }): React.JSX.Element {
  if (value === null || value === undefined) return <p className="backup-muted">{copy.backupNoLocal}</p>;
  if (typeof value !== "object") return <p className="backup-value">{String(value)}</p>;
  if (Array.isArray(value)) return <ol className="backup-values">{value.map((child, index) => <li key={index}><BusinessData value={child} copy={copy} /></li>)}</ol>;
  return <dl className="backup-data">{Object.entries(value).filter(([key]) => !["id", "schema", "textHash", "searchText", "resultPreviews", "preview"].includes(key)).map(([key, child]) => <div key={key}><dt>{copy[FIELD_KEYS[key] ?? "backupDetails"]}</dt><dd><BusinessData value={child} copy={copy} /></dd></div>)}</dl>;
}

export function BackupComparison({ item, copy, selected, onSelect }: {
  item: BackupPreviewItem; copy: DesktopCopy; selected: boolean; onSelect: (value: boolean) => void;
}): React.JSX.Element {
  return <section className="backup-comparison" aria-label={item.title}>
    <header><span className="backup-muted">{backupKind(copy, item.kind)}</span><h3>{item.title}</h3></header>
    <div className="backup-choice">
      {item.blocked ? <p role="status">{copy.backupBlocked}</p> : item.status === "same" ? <p>{copy.backupSame}</p> : item.status === "conflict" ?
        <div className="backup-segments" role="group" aria-label={copy.backupReview}>
          <button type="button" aria-pressed={!selected} onClick={() => onSelect(false)}>{copy.backupKeepLocal}</button>
          <button type="button" aria-pressed={selected} onClick={() => onSelect(true)}>{copy.backupUseIncoming}</button>
        </div> : <label><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} />{item.note === "folder_reused" ? copy.backupReuseFolder : item.status === "deleted" ? copy.backupRestoreDeleted : copy.backupInclude}</label>}
      {item.note === "question_new_identity" ? <p>{copy.backupQuestionRemap}</p> : null}
      {item.note === "folder_reused" ? <p>{copy.backupFolderReused}</p> : null}
      {item.note === "folder_new_identity" ? <p>{copy.backupFolderRemap}</p> : null}
      {item.note === "dependency_required" && !item.blocked ? <p>{copy.backupDependency}</p> : null}
    </div>
    <div className="backup-versions">
      <section><h4>{copy.backupLocal}</h4><BusinessData value={item.local} copy={copy} /></section>
      <section><h4>{copy.backupIncoming}</h4><BusinessData value={item.backup} copy={copy} /></section>
    </div>
  </section>;
}
