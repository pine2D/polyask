import { useEffect, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteDefinition } from '../shared/contracts';
import type { QuestionDetail } from '../shared/question-history';
import { MarkdownPreview } from './markdown-preview';
import { answerState } from './question-history-model';
import { shell } from './shell-api';
import { ChevronDownIcon, CopyIcon, ExternalLinkIcon, LinkIcon } from './icons';
import { LibraryMenu } from './library-menu';
import { safeMarkdownUrl } from './markdown-inline';
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
  const conversationUrl = answer?.conversationUrl && safeMarkdownUrl(answer.conversationUrl) ? answer.conversationUrl : null;
  const canRestoreAll = detail.question.sites.some(key => {
    const latest = detail.answers.filter(a => a.site === key).at(-1);
    return !!(latest?.conversationUrl && safeMarkdownUrl(latest.conversationUrl));
  });
  return <div className="question-reader">
    <header className="question-reader-intro">
      <time>{new Date(detail.question.createdAt).toLocaleString()}</time>
      <h2>{detail.question.text}</h2>
      {detail.question.inputImageCount > 0 && <p>{formatCopy(copy.questionImages, { count: detail.question.inputImageCount })}</p>}
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
      <div className="question-actions question-reader-actions" role="group" aria-label={copy.questionActions}>
        <div className="question-answer-actions">
          <div className="question-restore-split">
            <button type="button" className="primary" disabled={busy || !conversationUrl} data-hint={busy ? copy.questionReadOnlyBusy : !conversationUrl ? copy.questionMissing : copy.questionOpenApp} onClick={() => onRestore(answer?.id)}>{copy.questionOpenApp}</button>
            <LibraryMenu key={`${detail.question.id}:${answer?.id ?? site}`} label={copy.questionRestoreOptions} icon={<ChevronDownIcon />} disabled={busy || !canRestoreAll}
              actions={[{ label: copy.questionRestoreAll, hint: copy.questionRestoreAllHint, run: () => onRestore() }]} />
          </div>
          <button type="button" className="question-icon-action" disabled={!conversationUrl} aria-label={copy.questionCopyLink} data-hint={conversationUrl ? copy.questionCopyLink : copy.questionMissing} onClick={() => {
            if (conversationUrl) void navigator.clipboard.writeText(conversationUrl).then(() => onAnnounce(copy.questionLinkCopied)).catch(() => onAnnounce(copy.questionFailed));
          }}><LinkIcon /></button>
          <button type="button" className="question-icon-action" disabled={!conversationUrl} aria-label={copy.questionOpenBrowser} data-hint={conversationUrl ? copy.questionOpenBrowser : copy.questionMissing} onClick={() => {
            if (conversationUrl) void shell.openExternal(conversationUrl).catch(() => onAnnounce(copy.questionFailed));
          }}><ExternalLinkIcon /></button>
          <button type="button" className="question-icon-action" aria-label={copy.questionCopy} data-hint={copy.questionCopy} disabled={!answer?.answerMarkdown} onClick={() => {
            void navigator.clipboard.writeText(answer?.answerMarkdown ?? '').then(() => onAnnounce(copy.questionCopied)).catch(() => onAnnounce(copy.questionFailed));
          }}><CopyIcon /></button>
        </div>
        <div className="question-prompt-actions">
          <button type="button" disabled={busy} onClick={onReask}>{copy.questionReask}</button>
          <LibraryMenu key={detail.question.id} label={copy.questionMenu} disabled={busy}
            actions={[{ label: copy.questionDeleteRecord, danger: true, run: onDelete }]} />
        </div>
      </div>
      {!answer?.conversationUrl && <p className="question-note">{copy.questionMissing}</p>}
      {answer?.answerMarkdown ? <MarkdownPreview value={answer.answerMarkdown} onOpenLink={url => { void shell.openExternal(url).catch(() => onAnnounce(copy.questionFailed)); }} /> : <p className="question-empty">{copy.questionNoAnswer}</p>}
    </section>
  </div>;
}
