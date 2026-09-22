import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteDefinition } from '../shared/contracts';
import type { QuestionSummary } from '../shared/question-history';
import { answerState, questionDay } from './question-history-model';
export function QuestionHistoryList({ items, sites, copy, busy, onRestore, onRead, onReask, onDelete }: {
  items: readonly QuestionSummary[]; sites: readonly SiteDefinition[]; copy: DesktopCopy; busy: boolean;
  onRestore: (id: string) => void; onRead: (id: string) => void; onReask: (text: string) => void; onDelete: (id: string) => void;
}): React.JSX.Element {
  const now = Date.now();
  return <ol className="question-list">{items.map((q, index) => {
    const group = questionDay(q.createdAt, now, copy);
    const canRestore = q.answers.some(a => a.conversationUrl);
    const labels = q.sites.map(key => sites.find(site => site.key === key)?.label ?? key);
    const siteNames = labels.join(' / ');
    const siteSummary = labels.slice(0, 2).join(' / ') + (labels.length > 2 ? ` +${labels.length - 2}` : '');
    const restoreHint = busy ? copy.questionReadOnlyBusy : !canRestore ? copy.questionMissing : copy.questionRestore;
    const states = [...new Set(q.answers.filter(a => a.capture !== 'complete').map(a => answerState(a, copy)))];
    return <li key={q.id}>
      {(index === 0 || questionDay(items[index - 1].createdAt, now, copy) !== group) && <h3 className="question-day">{group}</h3>}
      <article className="question-card">
        <button type="button" className="question-main" data-hint={`${copy.questionCopies} · ${siteNames}`}
          aria-label={`${copy.questionCopies}: ${q.text}. ${siteNames}`} onClick={() => onRead(q.id)}>
          <span className="question-title">{q.text}</span>
          <span className="question-meta"><time>{new Date(q.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span aria-hidden="true"> · </span><span aria-hidden="true">{siteSummary}</span><span className="sr-only">{siteNames}</span></span>
        </button>
        <div className="question-card-status">
          <span className="question-saved">{formatCopy(copy.questionSaved, { saved: q.savedSites, total: q.sites.length })}</span>
          {states.length > 0 && <span className="question-state-summary" tabIndex={0} data-hint={states.join(' · ')}>{states.join(' · ')}</span>}
        </div>
        <div className="question-card-actions">
          <button type="button" className="question-restore" aria-disabled={busy || !canRestore} data-hint={restoreHint} onClick={busy || !canRestore ? undefined : () => onRestore(q.id)}>{copy.questionRestore}</button>
          <details className="question-menu"><summary aria-label={`${copy.questionMenu}: ${q.text}`}>···</summary><div>
            <button type="button" disabled={busy} onClick={() => onReask(q.text)}>{copy.questionReask}</button>
            <button type="button" disabled={busy} onClick={() => onDelete(q.id)}>{copy.questionDelete}</button>
          </div></details>
        </div>
      </article>
    </li>;
  })}</ol>;
}
