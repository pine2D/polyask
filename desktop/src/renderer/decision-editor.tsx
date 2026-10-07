import { useId } from "react";
import type { ArchiveRecord } from "../shared/archive";
import type { DesktopCopy } from "../shared/copy";
import type { DecisionInput, DecisionRecord, DecisionStatus } from "../shared/decision";
import { LibrarySelect } from "./library-select";
import { MarkdownPreview } from "./markdown-preview";
import { decisionCharacterCount, type DecisionField, type DecisionFieldErrors, type DecisionValidationCode } from "./decision-validation";
export { validDecisionDraft, validateDecisionDraft } from "./decision-validation";

export const decisionStatuses: readonly DecisionStatus[] = ["draft", "verify", "final"];
export const decisionStatusLabel = (copy: DesktopCopy, status: DecisionStatus): string =>
  ({ draft: copy.decisionDraft, verify: copy.decisionVerify, final: copy.decisionFinal })[status];

export function decisionInput(record: DecisionInput): DecisionInput {
  return { archiveId: record.archiveId, title: record.title, conclusion: record.conclusion,
    rationale: record.rationale, uncertainties: record.uncertainties, nextStep: record.nextStep,
    status: record.status, evidence: record.evidence.map(({ resultIndex, excerpt }) => ({ resultIndex, excerpt })) };
}

interface Props {
  readonly copy: DesktopCopy;
  readonly value: DecisionInput;
  readonly saved: DecisionRecord | null;
  readonly source: ArchiveRecord | null | undefined;
  readonly sourceFailed: boolean;
  readonly editing: boolean;
  readonly busy: boolean;
  readonly errors?: DecisionFieldErrors;
  readonly onChange: (value: DecisionInput) => void;
  readonly onOpenLink?: (url: string) => void;
  readonly onOpenSource: () => void;
}

export function DecisionEditor({ copy, value, saved, source, sourceFailed, editing, busy, errors = {}, onChange, onOpenSource, onOpenLink }: Props): React.JSX.Element {
  const prefix = useId();
  const fieldId = (field: DecisionField) => `${prefix}-${field}`;
  const messages: Record<DecisionValidationCode, string> = {
    title_required: copy.decisionTitleRequired, title_too_long: copy.decisionTitleTooLong,
    body_too_long: copy.decisionBodyTooLong, final_conclusion_required: copy.decisionFinalConclusionRequired,
    too_many_evidence: copy.decisionEvidenceTooMany, duplicate_source: copy.decisionEvidenceDuplicate,
    invalid_evidence_source: copy.decisionEvidenceSourceInvalid, excerpt_required: copy.decisionExcerptRequired,
    excerpt_too_long: copy.decisionExcerptTooLong, excerpt_not_in_source: copy.decisionExcerptMismatch,
    source_unavailable: copy.decisionExcerptSourceUnavailable
  };
  const aria = (field: DecisionField) => ({ id: fieldId(field), "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": `${fieldId(field)}-count${errors[field] ? ` ${fieldId(field)}-error` : ""}` });
  const hints = (field: DecisionField, text: string, limit: number) => <div className="decision-field-hints">
    <span id={`${fieldId(field)}-count`} className="decision-count">{decisionCharacterCount(text)} / {limit}</span>
    {errors[field] ? <p id={`${fieldId(field)}-error`} className="decision-field-error">{messages[errors[field]]}</p> : null}
  </div>;
  const fields = [
    ["conclusion", copy.decisionConclusion], ["rationale", copy.decisionRationale],
    ["uncertainties", copy.decisionUncertainties], ["nextStep", copy.decisionNextStep]
  ] as const;
  const changeExcerpt = (index: number, excerpt: string) => onChange({ ...value,
    evidence: value.evidence.map((item, itemIndex) => itemIndex === index ? { ...item, excerpt } : item) });
  return <article className="decision-editor" data-editing={editing}>
    {editing ? <div className="decision-field"><label htmlFor={fieldId("title")}>{copy.decisionName}</label><input {...aria("title")} name="decision-title" autoComplete="off" value={value.title} disabled={busy} onChange={(event) => onChange({ ...value, title: event.target.value })} />{hints("title", value.title, 160)}</div> : <h1>{value.title}</h1>}
    <div className="decision-meta">
      <label>{copy.decisionStatus}{editing ? <LibrarySelect label={copy.decisionStatus} disabled={busy} value={value.status}
        options={decisionStatuses.map(status => ({ value: status, label: decisionStatusLabel(copy, status) }))}
        onChange={status => onChange({ ...value, status: status as DecisionStatus })} /> : <strong>{decisionStatusLabel(copy, value.status)}</strong>}</label>
      <p>{copy.decisionManual}</p>
    </div>
    <div className="decision-fields">{fields.map(([key, label]) => editing ? <div key={key} className="decision-field"><label htmlFor={fieldId(key)}>{label}</label><textarea {...aria(key)} name={`decision-${key}`} autoComplete="off" value={value[key]} disabled={busy} rows={key === "conclusion" ? 4 : 3} onChange={(event) => onChange({ ...value, [key]: event.target.value })} />{hints(key, value[key], 4000)}</div> : <section key={key}><h2>{label}</h2><MarkdownPreview onOpenLink={onOpenLink} value={value[key] || "—"} /></section>)}</div>
    <section className="decision-source">
      <strong>{copy.decisionSource}</strong><p>{source?.task || saved?.sourceTitle || "—"}</p>
      {source ? <button type="button" disabled={busy} onClick={onOpenSource}>{copy.decisionOpenSource}</button> : <p role="status">{source === null ? copy.decisionSourceMissing : sourceFailed ? copy.decisionSourceFailed : copy.decisionSourceLoading}</p>}
    </section>
    <section className="decision-evidence" tabIndex={errors.evidence ? -1 : undefined} aria-invalid={errors.evidence ? true : undefined} aria-describedby={errors.evidence ? `${prefix}-evidence-error` : undefined}><h2>{copy.decisionEvidence} · {value.evidence.length}/9</h2>
      {errors.evidence ? <p id={`${prefix}-evidence-error`} className="decision-field-error">{messages[errors.evidence]}</p> : null}
      {value.evidence.map((item, index) => {
        const field = `evidence-${index}` as const;
        const evidence = saved?.evidence.find((old) => old.resultIndex === item.resultIndex);
        const result = source?.results[item.resultIndex];
        return <section className="decision-excerpt" key={index}>
          <header><strong>{`[S${item.resultIndex + 1}]`} {result?.label || evidence?.label || `#${item.resultIndex + 1}`}</strong>{editing ? <button type="button" disabled={busy} onClick={() => onChange({ ...value, evidence: value.evidence.filter((_old, itemIndex) => itemIndex !== index) })}>{copy.decisionRemoveEvidence}</button> : null}</header>
          {editing && source ? <div className="decision-field"><label htmlFor={fieldId(field)}>{copy.decisionEvidenceHint}</label><textarea {...aria(field)} name={`decision-${field}`} aria-label={`${copy.decisionEvidence}: ${result?.label || item.resultIndex + 1}`} disabled={busy} rows={4} value={item.excerpt} onChange={(event) => changeExcerpt(index, event.target.value)} />{hints(field, item.excerpt, 4000)}</div> : <><blockquote {...(editing ? aria(field) : {})} tabIndex={editing && errors[field] ? -1 : undefined}>{item.excerpt}</blockquote>{editing ? hints(field, item.excerpt, 4000) : null}</>}
        </section>;
      })}
      {editing && source ? source.results.map((result, resultIndex) => result.text?.trim() ? <details key={resultIndex} className="decision-answer">
        <summary>{result.label}</summary><pre>{result.text}</pre>
        <button type="button" disabled={busy || value.evidence.length >= 9 || value.evidence.some((item) => item.resultIndex === resultIndex)} onClick={() => onChange({ ...value, evidence: [...value.evidence, { resultIndex, excerpt: "" }] })}>{copy.decisionAddEvidence}</button>
      </details> : null) : null}
    </section>
  </article>;
}
