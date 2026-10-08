import { useLayoutEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import type { QuestionDetail } from '../shared/question-history';
import { MarkdownPreview } from './markdown-preview';
import { answerState, type QuestionDetailView } from './question-history-model';
import { shell } from './shell-api';
import { safeMarkdownUrl } from './markdown-inline';
import { QuestionHistoryActions } from './question-history-actions';
import { QuestionReaderSession } from './question-reader-session';
import { QuestionPrompt } from './question-prompt';

export function QuestionHistoryReader({ detail, view, session: suppliedSession, copy, sites, busy, onLoadAnswer,
  onRestore, onReask, onDelete, onAnnounce, onOrganize }: {
  detail: QuestionDetail; view?: QuestionDetailView; session?: QuestionReaderSession;
  copy: DesktopCopy; sites: readonly SiteDefinition[]; busy: boolean; onLoadAnswer?: (id: string) => void;
  onRestore: (answerId?: string) => void; onReask: () => void; onDelete: () => void; onAnnounce: (text: string) => void;
  onOrganize?: (answerId: string) => void;
}): React.JSX.Element {
  const fallback = useRef(new QuestionReaderSession()), scroller = useRef<HTMLDivElement>(null);
  const session = suppliedSession ?? fallback.current;
  const [site, setSite] = useState(() => session.site(detail));
  const [attempt, setAttempt] = useState(() => session.answer(detail, site));
  const answers = detail.answers.filter(answer => answer.site === site);
  const answer = answers.find(a => a.id === attempt) ?? answers.at(-1);
  const ready = !answer || !view || (view.state === 'ready' && (!view.answerId || view.answerId === answer?.id) &&
    (detail.loadedAnswerId === undefined || detail.loadedAnswerId === answer?.id));
  const remember = () => { if (ready && answer && scroller.current) session.remember(answer.id, scroller.current.scrollTop); };
  const choose = (key: SiteKey, id?: string) => {
    remember(); session.select(detail, key, id); setSite(key); setAttempt(id); if (id) onLoadAnswer?.(id);
  };
  const latest = useRef({ remember }); latest.current = { remember };
  useLayoutEffect(() => {
    session.select(detail, site, answer?.id);
    if (ready && scroller.current) scroller.current.scrollTop = session.position(answer?.id);
  }, [answer?.id, ready]);
  useLayoutEffect(() => () => latest.current.remember(), []);
  const conversationUrl = answer?.conversationUrl && safeMarkdownUrl(answer.conversationUrl) ? answer.conversationUrl : null;
  const canRestoreAll = detail.question.sites.some(key => {
    const latest = detail.answers.filter(a => a.site === key).at(-1);
    return !!(latest?.conversationUrl && safeMarkdownUrl(latest.conversationUrl));
  });
  return <div className="question-reader" ref={scroller} onScroll={remember}>
    <header className="question-reader-intro">
      <time>{new Date(detail.question.createdAt).toLocaleString()}</time>
      <QuestionPrompt text={detail.question.text} copy={copy} />
      {detail.question.inputImageCount > 0 && <p>{formatCopy(copy.questionImages, { count: detail.question.inputImageCount })}</p>}
    </header>
    <div className="question-site-tabs" role="group" aria-label={copy.sitesCompact}>
      {detail.question.sites.map(key => <button type="button" key={key} aria-pressed={site === key}
        onClick={() => choose(key, session.answer(detail, key))}>{sites.find(s => s.key === key)?.label ?? key}</button>)}
    </div>
    <section className="question-answer" aria-label={copy.questionCopies} aria-busy={!ready && view?.state === 'loading'}>
      <div className="question-answer-meta">
        <label>{copy.questionCopies} <select value={answer?.id ?? ''} onChange={e => choose(site, e.target.value)}>
          {answers.map(a => <option value={a.id} key={a.id}>{formatCopy(copy.questionAttempt, { number: a.attempt })}</option>)}
        </select></label>
        {answer && <span className={`question-status is-${answer.capture}`}>{answerState(answer, copy)}</span>}
        {answer?.capturedAt != null && <time>{formatCopy(copy.questionCaptured, { time: new Date(answer.capturedAt).toLocaleString() })}</time>}
      </div>
      <p className="question-note">{copy.questionSnapshotNote}</p>
      {answer?.truncated && <p role="note">{copy.questionTruncated}</p>}
      <QuestionHistoryActions questionId={detail.question.id} prompt={detail.question.text} answer={answer} site={site} conversationUrl={conversationUrl}
        canRestoreAll={canRestoreAll} ready={ready} copy={copy} busy={busy} onRestore={onRestore} onReask={onReask}
        onDelete={onDelete} onAnnounce={onAnnounce} onOrganize={onOrganize && answer ? () => onOrganize(answer.id) : undefined} />
      {!answer?.conversationUrl && <p className="question-note">{copy.questionMissing}</p>}
      {!ready ? <div className="question-empty" data-state={view?.state} role={view?.state === 'failed' ? 'alert' : 'status'}>
        {view?.state === 'failed' ? copy.questionAnswerFailed : view?.state === 'missing' ? copy.questionCopyChanged : copy.questionAnswerLoading}
        {view?.state !== 'loading' && answer && <button type="button" onClick={() => onLoadAnswer?.(answer.id)}>{copy.questionRetry}</button>}
      </div> : answer?.answerMarkdown ? <MarkdownPreview value={answer.answerMarkdown} onOpenLink={url => { void shell.openExternal(url).catch(() => onAnnounce(copy.questionFailed)); }} /> : <p className="question-empty">{copy.questionNoAnswer}</p>}
    </section>
  </div>;
}
