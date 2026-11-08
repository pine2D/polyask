import { useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import type { DecisionEvidenceInput } from '../shared/decision';
import { FolderModal } from './folder-modal';

/** Stable identity for legacy records without changing their saved wire representation. */
export const evidenceKey = (item: DecisionEvidenceInput): string => item.id ?? `legacy:${item.resultIndex}`;
export function evidenceGroups<T extends DecisionEvidenceInput>(items: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) { const topic = item.topic ?? ''; groups.set(topic, [...(groups.get(topic) ?? []), item]); }
  return [...groups];
}
export function EvidenceOverview({ copy, items, source, sourceUpdatedAt }: {
  copy: DesktopCopy; items: readonly (DecisionEvidenceInput & {label?: string; host?: string; sourceUpdatedAt?: number; start?: number})[];
  source: ArchiveRecord | null | undefined; sourceUpdatedAt?: number;
}) {
  const [review, setReview] = useState<typeof items[number] | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const original = review && source?.results[review.resultIndex];
  const changed = !!review && !!source && ((review.sourceUpdatedAt ?? sourceUpdatedAt) !== undefined &&
    (review.sourceUpdatedAt ?? sourceUpdatedAt) !== source.updatedAt || !original?.text?.includes(review.excerpt) ||
    (review.host !== undefined && review.host !== original?.host));
  useLayoutEffect(() => {
    if (!review || !field.current || changed) return;
    const text = original?.text ?? '';
    const start = review.start ?? text.indexOf(review.excerpt);
    const displayed = (offset: number) => text.slice(0, offset).replace(/\r\n?/g, '\n').length;
    if (start >= 0) { field.current.focus(); field.current.setSelectionRange(displayed(start), displayed(start + review.excerpt.length)); }
  }, [review, changed]);
  return <section className="evidence-overview" aria-label={copy.evidenceByTopic}>
    <h3>{copy.evidenceByTopic}</h3>
    {evidenceGroups(items).map(([topic, group]) => <section key={topic} data-evidence-topic={topic}>
      <h4>{topic || copy.evidenceUnassigned}</h4>
      {group.map(item => <div key={evidenceKey(item)} className="evidence-overview-item">
        <strong>[S{item.resultIndex + 1}] {item.label || source?.results[item.resultIndex]?.label}</strong>
        <blockquote>{item.excerpt}</blockquote>
        <button type="button" onClick={() => setReview(item)}>{copy.evidenceReview}</button>
      </div>)}
    </section>)}
    {review ? <FolderModal copy={copy} title={copy.evidenceReview} busy={false} onCancel={() => setReview(null)}>
      <p>[S{review.resultIndex + 1}] {review.label || original?.label}</p>
      <blockquote>{review.excerpt}</blockquote>
      {!source ? <p role="status">{copy.decisionSourceMissing}</p> : changed ? <p role="status">{copy.manualSourceChanged}</p> : null}
      {original?.text ? <textarea ref={field} name="evidence-review-original" aria-label={copy.excerptOriginal} readOnly value={original.text} /> : null}
    </FolderModal> : null}
  </section>;
}
