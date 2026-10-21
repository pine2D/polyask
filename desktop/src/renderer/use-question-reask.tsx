import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { ipcErrorCode } from '../shared/ipc-error';
import { validateImages, type DesktopImage } from '../shared/images';
import type { QuestionReask } from '../shared/question-attachments';
import { ConfirmDialog } from './confirm-dialog';
import { shell } from './shell-api';

type Target = { id?: string; text: string; imageCount: number };
type Request = { epoch: number; intent: string; target: Target };
type Stage = { request: Request; kind: 'loading' | 'missing' | 'failed' } |
  { request: Request; kind: 'confirm'; value: QuestionReask; textOnly: boolean };

export function useQuestionReask(options: {
  open: boolean; active: boolean; busy: boolean; draft: string; draftImageCount: number; copy: DesktopCopy;
  draftIntent?: () => string; imageSyncEnabled: boolean;
  onDraft: (text: string, images: readonly DesktopImage[]) => void; onDone: () => void;
}) {
  const latest = useRef(options); latest.current = options;
  const epoch = useRef(0), [stage, setStage] = useState<Stage | null>(null);
  const fallback = useRef({ text: options.draft, count: options.draftImageCount, revision: 0 });
  if (fallback.current.text !== options.draft || fallback.current.count !== options.draftImageCount) {
    fallback.current = { text: options.draft, count: options.draftImageCount, revision: fallback.current.revision + 1 };
  }
  const intent = () => latest.current.draftIntent?.() ?? String(fallback.current.revision);
  const current = (request: Request) => request.epoch === epoch.current && request.intent === intent() &&
    latest.current.open && latest.current.active && !latest.current.busy;
  const invalidate = () => { epoch.current++; setStage(null); };
  useEffect(() => { if (!options.open || !options.active || options.busy) invalidate(); }, [options.open, options.active, options.busy]);
  useEffect(() => () => { epoch.current++; }, []);
  const apply = (request: Request, value: QuestionReask) => {
    if (!current(request)) { setStage(null); return; }
    epoch.current++; setStage(null);
    latest.current.onDraft(value.text, value.images); latest.current.onDone();
  };
  const ready = (request: Request, value: QuestionReask, textOnly: boolean) => {
    if (!current(request)) return;
    const images = validateImages(value.images);
    if (!images || (request.target.id && value.questionId !== request.target.id) ||
      (!textOnly && images.length !== request.target.imageCount)) throw new Error('question_attachments_unavailable');
    const validated = { ...value, images };
    if (latest.current.draft.length || latest.current.draftImageCount || textOnly) setStage({ request, kind: 'confirm', value: validated, textOnly });
    else apply(request, validated);
  };
  const load = async (request: Request, textOnly = false, fetch = false) => {
    if (!current(request)) { setStage(null); return; }
    setStage({ request, kind: 'loading' });
    try {
      if (fetch) {
        const fetched = await shell.questionFetchAttachments?.(request.target.id!);
        if (!current(request)) return;
        if (!fetched) throw new Error('question_attachments_unavailable');
      }
      let value: QuestionReask;
      if (textOnly && request.target.id) {
        const detail = await shell.getQuestion(request.target.id);
        if (!current(request)) return;
        if (!detail || detail.question.id !== request.target.id) throw new Error('history_not_found');
        value = { questionId: detail.question.id, text: detail.question.text, images: [] };
      } else value = request.target.id ? await shell.questionReask(request.target.id) : { questionId: '', text: request.target.text, images: [] };
      if (!current(request)) return;
      ready(request, value, textOnly);
    } catch (error) {
      if (current(request)) setStage({ request, kind: ipcErrorCode(error) === 'question_attachments_unavailable' ? 'missing' : 'failed' });
    } finally { if (request.epoch === epoch.current && !current(request)) setStage(null); }
  };
  const start = (target: Target) => {
    const request = { target, epoch: ++epoch.current, intent: intent() };
    void load(request);
  };
  const visible = stage && current(stage.request) ? stage : null;
  const copy = options.copy;
  const feedback = visible?.kind === 'confirm' ? <ConfirmDialog copy={copy} title={copy.questionDraftTitle}
    message={visible.textOnly ? `${copy.questionOriginalTextWarning}\n${copy.questionOriginalReplace}` : copy.questionOriginalReplace}
    confirmLabel={visible.textOnly ? copy.questionOriginalTextOnly : copy.questionReask} cancelLabel={copy.cancel}
    onConfirm={() => apply(visible.request, visible.value)} onCancel={invalidate} /> : visible ? <div className="question-notice" role={visible.kind === 'loading' ? 'status' : 'alert'}>
      {visible.kind === 'loading' ? copy.questionReaskLoading : visible.kind === 'missing' ? copy.questionOriginalsMissing : copy.questionOriginalsFailed}
      {visible.kind !== 'loading' && <>
        <button type="button" onClick={() => { void load(visible.request); }}>{copy.questionRetry}</button>
        {visible.request.target.id && options.imageSyncEnabled && shell.questionFetchAttachments && <button type="button" onClick={() => { void load(visible.request, false, true); }}>{copy.questionOriginalFetch}</button>}
        <button type="button" onClick={() => { void load(visible.request, true); }}>{copy.questionOriginalTextOnly}</button>
      </>}
      <button type="button" onClick={invalidate}>{copy.cancel}</button>
    </div> : null;
  return { start, invalidate, feedback, blocking: visible?.kind === 'loading' || visible?.kind === 'confirm', confirming: visible?.kind === 'confirm' };
}
