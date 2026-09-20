import type { ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { DecisionInput, DecisionRecord, DecisionStatus } from "../shared/decision";
import { MarkdownPreview } from "./markdown-preview";

export const decisionStatuses: readonly DecisionStatus[] = ["draft", "verify", "final"];
export const decisionStatusLabel = (copy: DesktopCopy, status: DecisionStatus): string =>
  ({ draft: copy.decisionDraft, verify: copy.decisionVerify, final: copy.decisionFinal })[status];

export function decisionInput(record: DecisionInput): DecisionInput {
  return { archiveId: record.archiveId, title: record.title, conclusion: record.conclusion,
    rationale: record.rationale, uncertainties: record.uncertainties, nextStep: record.nextStep,
    status: record.status, evidence: record.evidence.map(({ resultIndex, excerpt }) => ({ resultIndex, excerpt })) };
}

export function validDecisionDraft(input: DecisionInput, source: ArchiveRecord | null | undefined, saved: DecisionRecord | null): boolean {
  if (!input.title.trim() || [...input.title].length > 160) return false;
  if ([input.conclusion, input.rationale, input.uncertainties, input.nextStep].some((value) => [...value].length > 4000)) return false;
  if (input.status === "final" && !input.conclusion.trim()) return false;
  if (input.evidence.length > 9 || new Set(input.evidence.map((item) => item.resultIndex)).size !== input.evidence.length) return false;
  return input.evidence.every((item) => {
    if (!item.excerpt.trim() || [...item.excerpt].length > 4000) return false;
    // 来源尚未读到时也只允许保留原有摘录，不能据此声称来源已删除。
    if (!source) return !!saved?.evidence.some((old) => old.resultIndex === item.resultIndex && old.excerpt === item.excerpt);
    return !!source.results[item.resultIndex]?.text?.includes(item.excerpt);
  });
}

interface Props {
  readonly copy: DesktopCopy;
  readonly value: DecisionInput;
  readonly saved: DecisionRecord | null;
  readonly source: ArchiveRecord | null | undefined;
  readonly sourceFailed: boolean;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly onChange: (value: DecisionInput) => void;
  readonly onOpenSource: () => void;
}

export function DecisionEditor({ copy, value, saved, source, sourceFailed, editing, busy, onChange, onOpenSource }: Props): React.JSX.Element {
  const fields = [
    ["conclusion", copy.decisionConclusion], ["rationale", copy.decisionRationale],
    ["uncertainties", copy.decisionUncertainties], ["nextStep", copy.decisionNextStep]
  ] as const;
  const changeExcerpt = (resultIndex: number, excerpt: string) => onChange({ ...value,
    evidence: value.evidence.map((item) => item.resultIndex === resultIndex ? { resultIndex, excerpt } : item) });
  return <article className="decision-editor">
    {editing ? <label>{copy.decisionName}<input name="decision-title" value={value.title} disabled={busy} onChange={(event) => onChange({ ...value, title: event.target.value })} /></label> : <h1>{value.title}</h1>}
    <div className="decision-meta">
      <label>{copy.decisionStatus}{editing ? <select name="decision-status" disabled={busy} value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value as DecisionStatus })}>
        {decisionStatuses.map((status) => <option key={status} value={status}>{decisionStatusLabel(copy, status)}</option>)}
      </select> : <strong>{decisionStatusLabel(copy, value.status)}</strong>}</label>
      <p>{copy.decisionManual}</p>
    </div>
    <section className="decision-source">
      <strong>{copy.decisionSource}</strong><p>{source?.task || saved?.sourceTitle || "—"}</p>
      {source ? <button type="button" disabled={busy} onClick={onOpenSource}>{copy.decisionOpenSource}</button> : <p role="status">{source === null ? copy.decisionSourceMissing : sourceFailed ? copy.decisionSourceFailed : copy.decisionSourceLoading}</p>}
    </section>
    <div className="decision-fields">{fields.map(([key, label]) => editing ? <label key={key}>{label}<textarea name={`decision-${key}`} value={value[key]} disabled={busy} rows={key === "conclusion" ? 4 : 3} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label> : <section key={key}><h2>{label}</h2><MarkdownPreview value={value[key] || "—"} /></section>)}</div>
    <section className="decision-evidence"><h2>{copy.decisionEvidence} · {value.evidence.length}/9</h2>
      {value.evidence.map((item) => {
        const evidence = saved?.evidence.find((old) => old.resultIndex === item.resultIndex);
        const result = source?.results[item.resultIndex];
        return <section className="decision-excerpt" key={item.resultIndex}>
          <header><strong>{result?.label || evidence?.label || `#${item.resultIndex + 1}`}</strong>{editing ? <button type="button" disabled={busy} onClick={() => onChange({ ...value, evidence: value.evidence.filter((old) => old.resultIndex !== item.resultIndex) })}>{copy.decisionRemoveEvidence}</button> : null}</header>
          {editing && source ? <label>{copy.decisionEvidenceHint}<textarea aria-label={`${copy.decisionEvidence}: ${result?.label || item.resultIndex + 1}`} disabled={busy} rows={4} value={item.excerpt} onChange={(event) => changeExcerpt(item.resultIndex, event.target.value)} /></label> : <blockquote>{item.excerpt}</blockquote>}
        </section>;
      })}
      {editing && source ? source.results.map((result, resultIndex) => result.text?.trim() ? <details key={resultIndex} className="decision-answer">
        <summary>{result.label}</summary><pre>{result.text}</pre>
        <button type="button" disabled={busy || value.evidence.length >= 9 || value.evidence.some((item) => item.resultIndex === resultIndex)} onClick={() => onChange({ ...value, evidence: [...value.evidence, { resultIndex, excerpt: "" }] })}>{copy.decisionAddEvidence}</button>
      </details> : null) : null}
    </section>
  </article>;
}
