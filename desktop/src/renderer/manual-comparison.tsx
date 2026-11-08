import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import type { DecisionInput } from '../shared/decision';
import { answerSourceId } from '../shared/answer-source';
import { validateExcerpt, type ExactExcerpt, type ExcerptSource } from './answer-excerpt';
import { COMPARISON_CATEGORIES, comparisonCategoryLabel, comparisonDecisionInput, emptyComparisonDraft, type ComparisonCategory, type ComparisonDraft } from './comparison-draft';
import { createComparisonDraftStore, type ComparisonDraftStore } from './comparison-draft-store';
import { evidenceTuple } from '../shared/decision';
import { EvidenceOverview, evidenceKey } from './evidence-overview';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';
import { usePersistentDraft } from './use-persistent-draft';
import { DraftRecovery } from './draft-recovery';
import { parseComparisonContent } from './editor-draft-content';
import { ArchiveAnswerReading } from './archive-answer-reading';

function ManualNote({ copy, category, source, value, selected, onSelect, onChange }: {
  copy: DesktopCopy; category: ComparisonCategory; source: ExcerptSource; value: string; selected: boolean;
  onSelect: (selected: boolean) => void; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(!!value || selected);
  useEffect(() => { if (value || selected) setOpen(true); }, [value, selected]);
  return <details className="manual-category" data-library-return={`category:${source.resultIndex}:${category}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{comparisonCategoryLabel(copy, category)}</summary>
    <label><input type="checkbox" name="manual-category" data-source-index={source.resultIndex} value={category}
      aria-label={`${source.label} · ${comparisonCategoryLabel(copy, category)}`}
      checked={selected} onChange={event => onSelect(event.target.checked)} />{copy.manualClassify}</label>
    <textarea aria-label={`${source.label} · ${comparisonCategoryLabel(copy, category)}`} name={`comparison-note-${category}-${source.resultIndex}`}
      placeholder={copy.manualEmpty} value={value} onChange={event => onChange(event.target.value)} />
  </details>;
}

export function useComparisonWorksheet(record: ArchiveRecord | undefined, provided?: ComparisonDraftStore,
  visibility?: { readonly open: boolean; readonly change: (open: boolean) => void }) {
  const fallback = useRef<ComparisonDraftStore | null>(null);
  if (!fallback.current) fallback.current = createComparisonDraftStore();
  const store = provided ?? fallback.current;
  const [draft, setDraft] = useState<ComparisonDraft | null>(() => record ? store.restore(record)?.draft ?? emptyComparisonDraft(record) : null);
  const [localOpen, setLocalOpen] = useState(false), [addError, setAddError] = useState<'duplicate' | 'limit' | null>(null);
  const open = visibility?.open ?? localOpen, setOpen = visibility?.change ?? setLocalOpen;
  const epoch = useRef(0), mounted = useRef(false), excerptFocus = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useLayoutEffect(() => { setDraft(record ? store.restore(record)?.draft ?? emptyComparisonDraft(record) : null); setAddError(null); setLocalOpen(false); excerptFocus.current = null; epoch.current++; }, [record?.id, store]);
  const change = (next: ComparisonDraft) => { if (record?.id !== next.archiveId) return; epoch.current++; store.save(record, next); setDraft(next); };
  const persistent = usePersistentDraft({ kind: 'comparison', context: record?.id ?? '',
    title: [...(record?.task || record?.text || '')].slice(0, 160).join(''), content: draft,
    sourceUpdatedAt: draft?.sourceUpdatedAt, enabled: !!record,
    dirty: !!draft && (!!draft.quotes.length || !!draft.judgment || !!draft.nextStep ||
      Object.values(draft.categories).some(v => v.length > 0) || Object.values(draft.notes).some(v => Object.values(v).some(Boolean))),
    onRestore: value => { const restored = record && parseComparisonContent(value, record.id);
      if (!restored) return false; change(restored); setOpen(true); return true; } });
  const add = (value: ExactExcerpt) => {
    excerptFocus.current = null;
    if (!record || !draft || !validateExcerpt(record, value) || [...value.excerpt].length > 4000) return;
    if (draft.quotes.some(old => evidenceTuple(old) === evidenceTuple(value))) { setAddError('duplicate'); return; }
    if (draft.quotes.length >= 36) { setAddError('limit'); return; }
    setAddError(null);
    const id = crypto.randomUUID();
    excerptFocus.current = id;
    change({ ...draft, sourceUpdatedAt: record.updatedAt, quotes: [...draft.quotes, { ...value, id }] }); setOpen(true);
    return id;
  };
  return { draft, change, open, setOpen, add, addError, epoch, mounted, excerptFocus, recovery: persistent.recovery };
}

export function ManualComparison(props: {
  readonly detailsRef?: React.RefObject<HTMLDetailsElement | null>;
  readonly workspace?: boolean;
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly sources: readonly ExcerptSource[];
  readonly worksheet: ReturnType<typeof useComparisonWorksheet>;
  readonly busy: boolean;
  readonly onCreate?: (record: ArchiveRecord, draft: DecisionInput, origin?: string) => void;
}): React.JSX.Element | null {
  const { copy, worksheet, record } = props, draft = worksheet.draft;
  const [message, setMessage] = useState(''), [checking, setChecking] = useState(false);
  const localDetailsRef = useRef<HTMLDetailsElement>(null), detailsRef = props.detailsRef ?? localDetailsRef;
  const excerptFocus = worksheet.excerptFocus;
  useLayoutEffect(() => {
    const id = excerptFocus.current;
    excerptFocus.current = null;
    if (id === null) return;
    const field = [...(detailsRef.current?.querySelectorAll<HTMLTextAreaElement>('[data-comparison-evidence]') ?? [])]
      .find(node => node.dataset.comparisonEvidence === id);
    if (field) { field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'nearest' }); }
  }, [draft?.quotes]);
  const latest = useRef(props); latest.current = props;
  if (!draft) return null;
  const duplicate = new Set(draft.quotes.map(evidenceTuple)).size !== draft.quotes.length;
  const topicTooLong = draft.quotes.some(q => [...(q.topic ?? "")].length > 120);
  const invalid = draft.quotes.some(value => !validateExcerpt(record, value));
  const change = (next: ComparisonDraft) => { setChecking(false); worksheet.change(next); };
  const form = () => {
    if (!props.onCreate || props.busy || checking || invalid || duplicate || topicTooLong) return;
    const request = ++worksheet.epoch.current;
    const active = () => worksheet.mounted.current && request === worksheet.epoch.current && !latest.current.busy;
    requestDecisionNavigation(() => {
      if (!active()) return;
      setChecking(true); setMessage('');
      void shell.getArchive(record.id).then(source => {
        if (!active()) return;
        const input = source ? comparisonDecisionInput(source, draft, copy) : null;
        if (!source) setMessage(copy.excerptSourceMissing);
        else if (!input) setMessage(copy.synthesisSourceVersionChanged);
        else props.onCreate?.(source, input, 'manual');
      }).catch(() => { if (active()) setMessage(copy.archiveLoadFailed); })
        .finally(() => { if (worksheet.mounted.current && request === worksheet.epoch.current) setChecking(false); });
    });
  };
  return <>
    <details ref={detailsRef} id={props.workspace ? 'comparison-worksheet' : undefined} hidden={props.workspace && !worksheet.open}
      className="manual-comparison" data-library-return="manual" open={worksheet.open} onToggle={event => worksheet.setOpen(event.currentTarget.open)}>
      <summary>{copy.manualTitle}</summary><p>{copy.manualHint}</p>
      <DraftRecovery {...worksheet.recovery} copy={copy} sourceUpdatedAt={record.updatedAt} busy={props.busy || checking} />
      {invalid ? <p className="manual-source-changed" role="status">{copy.manualSourceChanged}</p> : null}
      {invalid ? <ul className="manual-invalid-quotes">{draft.quotes.filter(value => !validateExcerpt(record, value)).map(value => <li key={evidenceKey(value)}>
        {answerSourceId(value.resultIndex)} {value.label}<button type="button" onClick={() => change({ ...draft, quotes: draft.quotes.filter(old => evidenceKey(old) !== evidenceKey(value)) })}>{copy.manualRemoveExcerpt}</button>
      </li>)}</ul> : null}
      {duplicate ? <p role="status">{copy.decisionEvidenceDuplicate}</p> : null}
      {worksheet.addError ? <p role="status">{worksheet.addError === 'duplicate' ? copy.decisionEvidenceDuplicate : copy.decisionEvidenceTooMany}</p> : null}
      {draft.quotes.length ? <EvidenceOverview copy={copy} items={draft.quotes} source={record} /> : null}
      <div className="manual-comparison-sources">{props.sources.map(source => {
        const quotes = draft.quotes.filter(value => value.resultIndex === source.resultIndex), index = source.resultIndex;
        return <section className="manual-comparison-source" data-source-index={index} key={source.host}>
          <h3>{answerSourceId(index)} {source.label}</h3>
          {source.truncated ? <p className="answer-capture-warning">{copy.answerTruncated}</p> : null}
          {quotes.map((quote, quoteIndex) => <div className="manual-quote" key={evidenceKey(quote)}>
            <label>{copy.evidenceTopic}<input name={`comparison-topic-${index}-${quoteIndex}`} value={quote.topic ?? ''} onChange={event => change({ ...draft,
              quotes: draft.quotes.map(old => evidenceKey(old) === evidenceKey(quote) ? {...old, id: old.id ?? `legacy:${old.resultIndex}`, topic:event.target.value} : old) })} /></label>
            {[...(quote.topic ?? '')].length > 120 ? <p role="status">{copy.evidenceTopicTooLong}</p> : null}
            <label>{copy.manualExcerpt}<textarea data-comparison-evidence={evidenceKey(quote)} name={`comparison-excerpt-${index}${quoteIndex ? `-${quoteIndex}` : ''}`} readOnly value={quote.excerpt} /></label>
            <button type="button" onClick={() => change({ ...draft, quotes: draft.quotes.filter(old => evidenceKey(old) !== evidenceKey(quote)) })}>{copy.manualRemoveExcerpt}</button>
          </div>)}
          {!quotes.length ? <p>{copy.manualEmpty}</p> : null}
          {worksheet.open ? <ArchiveAnswerReading copy={copy} source={source} busy={props.busy}
            onCompare={worksheet.add}>{null}</ArchiveAnswerReading> : null}
          {COMPARISON_CATEGORIES.map(category => <ManualNote key={`${source.host}:${category}`} copy={copy} source={source} category={category}
            selected={draft.categories[source.host]?.includes(category) ?? false} value={draft.notes[category][source.host] ?? ''}
            onSelect={selected => change({ ...draft, categories: { ...draft.categories, [source.host]: selected
              ? [...(draft.categories[source.host] ?? []), category] : (draft.categories[source.host] ?? []).filter(value => value !== category) } })}
            onChange={value => change({ ...draft, notes: { ...draft.notes, [category]: { ...draft.notes[category], [source.host]: value } } })} />)}
        </section>;
      })}</div>
      <label>{copy.manualJudgment}<textarea name="comparison-judgment" value={draft.judgment} onChange={event => change({ ...draft, judgment: event.target.value })} /></label>
      <label>{copy.manualNextStep}<textarea name="comparison-next-step" value={draft.nextStep} onChange={event => change({ ...draft, nextStep: event.target.value })} /></label>
      <button type="button" data-decision-origin="manual" disabled={props.busy || checking || invalid || duplicate || topicTooLong || !props.onCreate} onClick={form}>{copy.manualFormDecision}</button>
      <p role="status">{message}</p>
    </details>

  </>;
}
