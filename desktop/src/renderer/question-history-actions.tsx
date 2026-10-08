import type { DesktopCopy } from '../shared/copy';
import type { QuestionAnswerRecord } from '../shared/question-history';
import { shell } from './shell-api';
import { ChevronDownIcon, CopyIcon, ExternalLinkIcon, LinkIcon } from './icons';
import { LibraryMenu } from './library-menu';

export function QuestionHistoryActions({ questionId, prompt, answer, site, conversationUrl, canRestoreAll, ready, copy, busy,
  onRestore, onReask, onDelete, onAnnounce, onOrganize }: {
  questionId: string; prompt: string; answer?: QuestionAnswerRecord; site: string; conversationUrl: string | null;
  canRestoreAll: boolean; ready: boolean; copy: DesktopCopy; busy: boolean;
  onRestore: (id?: string) => void; onReask: () => void; onDelete: () => void;
  onAnnounce: (text: string) => void; onOrganize?: () => void;
}): React.JSX.Element {
  return <div className="question-actions question-reader-actions" role="group" aria-label={copy.questionActions}>
    <div className="question-answer-actions">
      <div className="question-restore-split">
        <button type="button" className="primary" disabled={busy || !conversationUrl} data-hint={busy ? copy.questionReadOnlyBusy : !conversationUrl ? copy.questionMissing : copy.questionOpenApp} onClick={() => onRestore(answer?.id)}>{copy.questionOpenApp}</button>
        <LibraryMenu key={`${questionId}:${answer?.id ?? site}`} label={copy.questionRestoreOptions} icon={<ChevronDownIcon />} disabled={busy || !canRestoreAll}
          actions={[{ label: copy.questionRestoreAll, hint: copy.questionRestoreAllHint, run: () => onRestore() }]} />
      </div>
      <button type="button" className="question-icon-action" disabled={!conversationUrl} aria-label={copy.questionCopyLink} data-hint={conversationUrl ? copy.questionCopyLink : copy.questionMissing} onClick={() => {
        if (conversationUrl) void navigator.clipboard.writeText(conversationUrl).then(() => onAnnounce(copy.questionLinkCopied)).catch(() => onAnnounce(copy.questionFailed));
      }}><LinkIcon /></button>
      <button type="button" className="question-icon-action" disabled={!conversationUrl} aria-label={copy.questionOpenBrowser} data-hint={conversationUrl ? copy.questionOpenBrowser : copy.questionMissing} onClick={() => {
        if (conversationUrl) void shell.openExternal(conversationUrl).catch(() => onAnnounce(copy.questionFailed));
      }}><ExternalLinkIcon /></button>
      <button type="button" className="question-icon-action" aria-label={copy.questionCopy} data-hint={copy.questionCopy} disabled={!ready || !answer?.answerMarkdown} onClick={() => {
        void navigator.clipboard.writeText(answer?.answerMarkdown ?? '').then(() => onAnnounce(copy.questionCopied)).catch(() => onAnnounce(copy.questionFailed));
      }}><CopyIcon /></button>
    </div>
    <div className="question-prompt-actions">
      <button type="button" className="question-icon-action" data-action="copy-question" aria-label={copy.questionCopyPrompt} data-hint={copy.questionCopyPrompt} onClick={() => {
        void navigator.clipboard.writeText(prompt).then(() => onAnnounce(copy.questionPromptCopied)).catch(() => onAnnounce(copy.questionFailed));
      }}><CopyIcon /></button>
      {onOrganize && <button type="button" data-action="organize-saved-answer" disabled={busy || !ready || !answer?.answerMarkdown} onClick={onOrganize}>{copy.questionOrganize}</button>}
      <button type="button" data-action="reask-question" disabled={busy} onClick={onReask}>{copy.questionReask}</button>
      <LibraryMenu key={questionId} label={copy.questionMenu} disabled={busy}
        actions={[{ label: copy.questionDeleteRecord, danger: true, run: onDelete }]} />
    </div>
  </div>;
}
