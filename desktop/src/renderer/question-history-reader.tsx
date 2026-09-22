import { useEffect, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteDefinition } from '../shared/contracts';
import type { QuestionDetail } from '../shared/question-history';
import { MarkdownPreview } from './markdown-preview';
import { answerState } from './question-history-model';
import { shell } from './shell-api';
export function QuestionHistoryReader({ detail, copy, sites, busy, onLoadAnswer, onRestore, onReask, onDelete, onAnnounce }: {
  detail: QuestionDetail; copy: DesktopCopy; sites: readonly SiteDefinition[]; busy: boolean;
  onLoadAnswer?: (id: string) => void;
  onRestore: (answerId?: string) => void; onReask: () => void; onDelete: () => void; onAnnounce: (text: string) => void;
}): React.JSX.Element {
  const [site, setSite] = useState(detail.question.sites[0]);
  const [attempt, setAttempt] = useState<string | null>(null);
  useEffect(() => { setSite(detail.question.sites[0]); setAttempt(null); }, [detail.question.id]);
  const answers = detail.answers.filter(answer => answer.site === site);
  const answer = answers.find(a => a.id === attempt) ?? answers.at(-1);
  return <div className="question-reader">
    <header className="question-reader-intro">
      <time>{new Date(detail.question.createdAt).toLocaleString()}</time>
      <h2>{detail.question.text}</h2>
      {detail.question.inputImageCount > 0 && <p>{formatCopy(copy.questionImages, { count: detail.question.inputImageCount })}</p>}
      <div className="question-actions">
        <button type="button" className="primary" data-hint={busy ? copy.questionReadOnlyBusy : copy.questionRestore} disabled={busy || !detail.answers.some(a => a.conversationUrl)} onClick={() => onRestore()}>{copy.questionRestore}</button>
        <button type="button" disabled={busy} onClick={onReask}>{copy.questionReask}</button>
        <button type="button" disabled={busy} onClick={onDelete}>{copy.questionDelete}</button>
      </div>
    </header>
    <div className="question-site-tabs" role="group" aria-label={copy.sitesCompact}>
      {detail.question.sites.map(key => <button type="button" key={key} aria-pressed={site === key} onClick={() => { setSite(key); setAttempt(null); const latest = detail.answers.filter(a => a.site === key).at(-1); if (latest) onLoadAnswer?.(latest.id); }}>{sites.find(s => s.key === key)?.label ?? key}</button>)}
    </div>
    <section className="question-answer" aria-label={copy.questionCopies}>
      <div className="question-answer-meta">
        <label>{copy.questionCopies} <select value={answer?.id ?? ''} onChange={e => { setAttempt(e.target.value); onLoadAnswer?.(e.target.value); }}>
          {answers.map(a => <option value={a.id} key={a.id}>{formatCopy(copy.questionAttempt, { number: a.attempt })}</option>)}
        </select></label>
        {answer && <span className={`question-status is-${answer.capture}`}>{answerState(answer, copy)}</span>}
        {answer?.capturedAt && <time>{formatCopy(copy.questionCaptured, { time: new Date(answer.capturedAt).toLocaleString() })}</time>}
      </div>
      <p className="question-note">{copy.questionSnapshotNote}</p>
      {answer?.truncated && <p role="note">{copy.questionTruncated}</p>}
      <div className="question-actions">
        <button type="button" disabled={busy || !answer?.conversationUrl} data-hint={busy ? copy.questionReadOnlyBusy : !answer?.conversationUrl ? copy.questionMissing : copy.questionRestore} onClick={() => onRestore(answer?.id)}>{copy.questionRestore}</button>
        <button type="button" disabled={!answer?.answerMarkdown} onClick={() => {
          void navigator.clipboard.writeText(answer?.answerMarkdown ?? '').then(() => onAnnounce(copy.questionCopied)).catch(() => onAnnounce(copy.questionFailed));
        }}>{copy.questionCopy}</button>
      </div>
      {!answer?.conversationUrl && <p className="question-note">{copy.questionMissing}</p>}
      {answer?.answerMarkdown ? <MarkdownPreview value={answer.answerMarkdown} onOpenLink={url => { void shell.openExternal(url).catch(() => onAnnounce(copy.questionFailed)); }} /> : <p className="question-empty">{copy.questionNoAnswer}</p>}
    </section>
  </div>;
}
