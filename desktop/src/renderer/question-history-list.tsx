import { formatCopy, type DesktopCopy } from '../shared/copy';
import { dateTimeAttribute, formatDateTime, formatListDate } from '../shared/format';
import type { QuestionSummary } from '../shared/question-history';
import { answerState, questionDay } from './question-history-model';
export function QuestionHistoryList({ items, copy, busy, locale = 'en', currentId, selecting, selectedIds, onToggle, onExport, onRestore, onRead, onReask, onDelete }: {
  items: readonly QuestionSummary[]; locale?: string; copy: DesktopCopy; busy: boolean;
  currentId?: string; selecting?: boolean; selectedIds?: readonly string[]; onToggle?: (id: string) => void; onExport?: (id: string) => void;
  onRestore: (id: string) => void; onRead: (id: string) => void; onReask: (id: string, text: string, imageCount: number) => void; onDelete: (id: string) => void;
}): React.JSX.Element {
  const now = Date.now();
  return <ol className="question-list">{items.map((q, index) => {
    const group = questionDay(q.createdAt, now, copy);
    const canRestore = q.answers.some(a => a.conversationUrl);
    const restoreHint = busy ? copy.questionReadOnlyBusy : !canRestore ? copy.questionMissing : copy.questionRestore;
    const states = [...new Set(q.answers.filter(a => a.capture !== 'complete').map(a => answerState(a, copy)))];
    const saved = formatCopy(copy.questionSaved, { saved: q.savedSites, total: q.sites.length });
    const attention = states.length ? states.join(' · ') : q.savedSites < q.sites.length ? saved : '';
    const instant = dateTimeAttribute(q.createdAt);
    return <li key={q.id} data-question-id={q.id}>
      {(index === 0 || questionDay(items[index - 1].createdAt, now, copy) !== group) && <h2 className="question-day">{group}</h2>}
      <article className="question-card" data-current={currentId === q.id || undefined}>
        <div className="question-card-heading">
        {selecting && <input className="question-card-select" type="checkbox" aria-label={q.text} checked={selectedIds?.includes(q.id) ?? false} disabled={busy} onChange={() => onToggle?.(q.id)} />}
        <button type="button" className="question-main" aria-current={currentId === q.id ? "true" : undefined} title={q.text}
          aria-label={`${copy.questionCopies}: ${q.text}`} aria-describedby={`question-meta-${q.id}`} onClick={() => onRead(q.id)}>
          <span className="question-title">{q.text}</span>
          <span className="question-meta" id={`question-meta-${q.id}`}>
            <time dateTime={instant} title={instant ? formatDateTime(q.createdAt, locale) : undefined}>{formatListDate(q.createdAt, locale, now)}</time>
            {q.inputImageCount > 0 && <span className="question-images" data-hint={formatCopy(copy.questionImages, { count: q.inputImageCount })}>{formatCopy(copy.questionImageCount, { count: q.inputImageCount })}</span>}
            {attention && <span className="question-saved question-state-summary" title={attention}>{attention}</span>}
          </span>
        </button></div>
        <div className="question-card-actions">
          <details className="question-menu"><summary aria-label={`${copy.questionMenu}: ${q.text}`}>···</summary><div>
            <button type="button" className="question-restore" aria-disabled={busy || !canRestore} data-hint={restoreHint} onClick={busy || !canRestore ? undefined : event => { event?.currentTarget.closest('details')?.removeAttribute('open'); onRestore(q.id); }}>{copy.questionRestore}</button>
            <button type="button" disabled={busy || !q.savedSites} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onExport?.(q.id); }}>{copy.markdownWhole}</button>
            <button type="button" disabled={busy} onClick={() => onReask(q.id, q.text, q.inputImageCount)}>{copy.questionReask}</button>
            <button type="button" disabled={busy} onClick={() => onDelete(q.id)}>{copy.questionDelete}</button>
          </div></details>
        </div>
      </article>
    </li>;
  })}</ol>;
}
