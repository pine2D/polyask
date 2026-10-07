import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import type { DecisionInput } from '../shared/decision';
import { answerSourceId } from '../shared/answer-source';
import { validateExcerpt, type ExactExcerpt, type ExcerptSource } from './answer-excerpt';
import { COMPARISON_CATEGORIES, comparisonCategoryLabel, comparisonDecisionInput, emptyComparisonDraft, type ComparisonDraft } from './comparison-draft';
import { createComparisonDraftStore, type ComparisonDraftStore } from './comparison-draft-store';
import { ExcerptReplacementDialog } from './excerpt-replacement-dialog';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';

export function useComparisonWorksheet(record: ArchiveRecord | undefined, provided?: ComparisonDraftStore) {
  const fallback = useRef<ComparisonDraftStore | null>(null);
  if (!fallback.current) fallback.current = createComparisonDraftStore();
  const store = provided ?? fallback.current;
  const [draft, setDraft] = useState<ComparisonDraft | null>(() => record ? store.restore(record)?.draft ?? emptyComparisonDraft(record) : null);
  const [open, setOpen] = useState(false), [replacement, setReplacement] = useState<ExactExcerpt | null>(null);
  const epoch = useRef(0), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useLayoutEffect(() => { setDraft(record ? store.restore(record)?.draft ?? emptyComparisonDraft(record) : null); setReplacement(null); setOpen(false); epoch.current++; }, [record?.id, store]);
  const change = (next: ComparisonDraft) => { if (record?.id !== next.archiveId) return; epoch.current++; store.save(record, next); setDraft(next); };
  const replace = (value: ExactExcerpt) => {
    if (!record || !draft || !validateExcerpt(record, value) || [...value.excerpt].length > 4000) return;
    change({ ...draft, sourceUpdatedAt: record.updatedAt, quotes: [...draft.quotes.filter(old => old.resultIndex !== value.resultIndex), value] }); setOpen(true);
  };
  const add = (value: ExactExcerpt) => {
    if (!record || !draft || !validateExcerpt(record, value)) return;
    const previous = draft.quotes.find(old => old.resultIndex === value.resultIndex);
    if (previous && previous.excerpt !== value.excerpt) setReplacement(value); else replace(value);
  };
  return { draft, change, open, setOpen, replacement, setReplacement, replace, add, epoch, mounted };
}

export function ManualComparison(props: {
  readonly copy: DesktopCopy;
  readonly record: ArchiveRecord;
  readonly sources: readonly ExcerptSource[];
  readonly worksheet: ReturnType<typeof useComparisonWorksheet>;
  readonly busy: boolean;
  readonly onCreate?: (record: ArchiveRecord, draft: DecisionInput) => void;
}): React.JSX.Element | null {
  const { copy, worksheet, record } = props, draft = worksheet.draft;
  const [message, setMessage] = useState(''), [checking, setChecking] = useState(false);
  const latest = useRef(props); latest.current = props;
  if (!draft) return null;
  const invalid = draft.quotes.some(value => !validateExcerpt(record, value));
  const change = (next: ComparisonDraft) => { setChecking(false); worksheet.change(next); };
  const form = () => {
    if (!props.onCreate || props.busy || checking || invalid) return;
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
        else props.onCreate?.(source, input);
      }).catch(() => { if (active()) setMessage(copy.archiveLoadFailed); })
        .finally(() => { if (worksheet.mounted.current && request === worksheet.epoch.current) setChecking(false); });
    });
  };
  return <>
    <details className="manual-comparison" open={worksheet.open} onToggle={event => worksheet.setOpen(event.currentTarget.open)}>
      <summary>{copy.manualTitle}</summary><p>{copy.manualHint}</p>
      {invalid ? <p className="manual-source-changed" role="status">{copy.manualSourceChanged}</p> : null}
      {invalid ? <ul className="manual-invalid-quotes">{draft.quotes.filter(value => !validateExcerpt(record, value)).map(value => <li key={value.resultIndex}>
        {answerSourceId(value.resultIndex)} {value.label}<button type="button" onClick={() => change({ ...draft, quotes: draft.quotes.filter(old => old.resultIndex !== value.resultIndex) })}>{copy.manualRemoveExcerpt}</button>
      </li>)}</ul> : null}
      <div className="manual-comparison-sources">{props.sources.map(source => {
        const quote = draft.quotes.find(value => value.resultIndex === source.resultIndex), index = source.resultIndex;
        return <section className="manual-comparison-source" data-source-index={index} key={source.host}>
          <h3>{answerSourceId(index)} {source.label}</h3>
          {source.truncated ? <p className="answer-capture-warning">{copy.answerTruncated}</p> : null}
          {quote ? <><label>{copy.manualExcerpt}<textarea name={`comparison-excerpt-${index}`} readOnly value={quote.excerpt} /></label><button type="button" onClick={() => change({ ...draft, quotes: draft.quotes.filter(old => old.resultIndex !== index) })}>{copy.manualRemoveExcerpt}</button></> : <p>{copy.manualEmpty}</p>}
          {COMPARISON_CATEGORIES.map(category => <section className="manual-category" key={category}>
            <label><input type="checkbox" name="manual-category" data-source-index={index} value={category} checked={draft.categories[source.host]?.includes(category) ?? false}
              onChange={event => change({ ...draft, categories: { ...draft.categories, [source.host]: event.target.checked
                ? [...(draft.categories[source.host] ?? []), category] : (draft.categories[source.host] ?? []).filter(value => value !== category) } })} />{comparisonCategoryLabel(copy, category)}</label>
            <textarea aria-label={`${source.label} · ${comparisonCategoryLabel(copy, category)}`} name={`comparison-note-${category}-${index}`} placeholder={copy.manualEmpty}
              value={draft.notes[category][source.host] ?? ''} onChange={event => change({ ...draft, notes: { ...draft.notes,
                [category]: { ...draft.notes[category], [source.host]: event.target.value } } })} />
          </section>)}
        </section>;
      })}</div>
      <label>{copy.manualJudgment}<textarea name="comparison-judgment" value={draft.judgment} onChange={event => change({ ...draft, judgment: event.target.value })} /></label>
      <label>{copy.manualNextStep}<textarea name="comparison-next-step" value={draft.nextStep} onChange={event => change({ ...draft, nextStep: event.target.value })} /></label>
      <button type="button" disabled={props.busy || checking || invalid || !props.onCreate} onClick={form}>{copy.manualFormDecision}</button>
      <p role="status">{message}</p>
    </details>
    {worksheet.replacement ? <ExcerptReplacementDialog copy={copy} message={copy.manualReplaceQuote} busy={props.busy}
      previous={draft.quotes.find(value => value.resultIndex === worksheet.replacement!.resultIndex)?.excerpt ?? ''}
      selected={worksheet.replacement} onCancel={() => worksheet.setReplacement(null)}
      onConfirm={() => { worksheet.replace(worksheet.replacement!); worksheet.setReplacement(null); }} /> : null}
  </>;
}
