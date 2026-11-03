import { QuestionAttachments } from './question-attachments';
import { useLayoutEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import type { QuestionDetail } from '../shared/question-history';
import { MarkdownPreview } from './markdown-preview';
import { answerState, type QuestionDetailView } from './question-history-model';
import { shell } from './shell-api';
import { safeMarkdownUrl } from './markdown-inline';
import { QuestionHistoryActions, QuestionHistoryRecordActions } from './question-history-actions';
import { QuestionReaderSession } from './question-reader-session';
import { QuestionPrompt } from './question-prompt';
import { answerSourceId } from '../shared/answer-source';
import { dateTimeAttribute, formatDateTime } from '../shared/format';
import { ReadingNavigation } from './reading-controls';
import { resolveLocale } from '../shared/locale';

export function QuestionHistoryReader({ detail, view, session: suppliedSession, copy, sites, busy, onLoadAnswer, locale = 'en',
  onRestore, onReask, onDelete, onAnnounce, onOrganize, onExportAnswer, onExportWhole, imageSyncEnabled }: {
  detail: QuestionDetail; view?: QuestionDetailView; session?: QuestionReaderSession; locale?: string;
  copy: DesktopCopy; sites: readonly SiteDefinition[]; busy: boolean; onLoadAnswer?: (id: string) => void;
  onRestore: (answerId?: string) => void; onReask: () => void; onDelete: () => void; onAnnounce: (text: string) => void;
  imageSyncEnabled?: boolean;
  onOrganize?: (answerId: string) => void; onExportAnswer?: (answerId: string) => void; onExportWhole?: () => void;
}): React.JSX.Element {
  const fallback = useRef(new QuestionReaderSession()), scroller = useRef<HTMLDivElement>(null);
  const calendarLocale = resolveLocale(locale) === 'zhCN' ? 'zh-CN' : resolveLocale(locale) === 'zhTW' ? 'zh-TW' : 'en';
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
  return <div className="question-reader" ref={scroller} onScroll={remember} tabIndex={0} role="region" aria-label={copy.questionCopies}>
    <article className="reading-page">
    <header className="question-reader-intro">
      <QuestionPrompt text={detail.question.text} copy={copy} />
      <div className="question-record-meta"><time dateTime={dateTimeAttribute(detail.question.createdAt)}>{formatDateTime(detail.question.createdAt, calendarLocale)}</time><div className="question-record-actions">
        <QuestionHistoryRecordActions questionId={detail.question.id} prompt={detail.question.text} canOrganize={ready && !!answer?.answerMarkdown}
          copy={copy} busy={busy} onReask={onReask} onDelete={onDelete} onAnnounce={onAnnounce} onExportWhole={onExportWhole}
          onOrganize={onOrganize && answer ? () => onOrganize(answer.id) : undefined} />
      </div></div>
      {detail.question.inputImageCount > 0 && <p>{formatCopy(copy.questionImages, { count: detail.question.inputImageCount })}</p>}
      {detail.question.inputImageCount > 0 && <QuestionAttachments questionId={detail.question.id} inputImageCount={detail.question.inputImageCount} copy={copy} imageSyncEnabled={imageSyncEnabled} />}
    </header>
    <ReadingNavigation activeSource={site} className="question-reading-navigation">
    <div className="question-reader-switches">
    <div className="question-site-tabs reading-source-list" role="group" aria-label={copy.sitesCompact}>
      {detail.question.sites.map(key => <button type="button" key={key} aria-pressed={site === key}
        onClick={() => choose(key, session.answer(detail, key))}>{sites.find(s => s.key === key)?.label ?? key}</button>)}
    </div>
    <label className="question-attempt-selector"><span className="sr-only">{copy.questionCopies}</span>
      <select value={answer?.id ?? ''} onChange={e => choose(site, e.target.value)}>
        {answers.map(a => <option value={a.id} key={a.id}>{formatCopy(copy.questionAttempt, { number: a.attempt })}</option>)}
      </select>
    </label>
    </div>
    </ReadingNavigation>
    <section className="question-answer" aria-label={copy.questionCopies} aria-busy={!ready && view?.state === 'loading'}>
      <details className="question-answer-info">
      <summary><span className="question-answer-meta">
        {!answer && <span>{copy.questionNoAnswer}</span>}
        {answer && <span className={`question-status is-${answer.capture}`}>{answerState(answer, copy)}</span>}
        {answer?.capturedAt != null && <time dateTime={dateTimeAttribute(answer.capturedAt)}>{formatCopy(copy.questionCaptured, { time: formatDateTime(answer.capturedAt, calendarLocale) })}</time>}
      </span></summary>
      <p className="question-note">{copy.questionSnapshotNote}</p>
      </details>
      {answer?.truncated && <p role="note">{copy.questionTruncated}</p>}
      <QuestionHistoryActions questionId={detail.question.id} answer={answer} site={site} conversationUrl={conversationUrl}
        canRestoreAll={canRestoreAll} ready={ready} copy={copy} busy={busy} onRestore={onRestore} onAnnounce={onAnnounce} onExportAnswer={answer && onExportAnswer ? () => onExportAnswer(answer.id) : undefined} />
      {!answer?.conversationUrl && <p className="question-note">{copy.questionMissing}</p>}
      {!ready ? <div className="question-empty" data-state={view?.state} role={view?.state === 'failed' ? 'alert' : 'status'}>
        {view?.state === 'failed' ? copy.questionAnswerFailed : view?.state === 'missing' ? copy.questionCopyChanged : copy.questionAnswerLoading}
        {view?.state !== 'loading' && answer && <button type="button" onClick={() => onLoadAnswer?.(answer.id)}>{copy.questionRetry}</button>}
      </div> : answer?.answerMarkdown ? <MarkdownPreview value={answer.answerMarkdown}
        contextLabel={`${answerSourceId(detail.question.sites.indexOf(site))} ${sites.find(value => value.key === site)?.label ?? site}`}
        onOpenLink={url => { void shell.openExternal(url).catch(() => onAnnounce(copy.questionFailed)); }} /> : <p className="question-empty">{copy.questionNoAnswer}</p>}
    </section>
    </article>
  </div>;
}
