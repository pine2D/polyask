import { questionReaskWarning, questionHistorySurface, type QuestionDetailView } from "./question-history-model";
import { QuestionReaderSession } from './question-reader-session';
import type { ArchiveRecord } from '../shared/archive';
import { resolveLocale } from '../shared/locale';
import { QuestionArchivePicker } from './question-archive-picker';
import { ipcErrorCode } from '../shared/ipc-error';
import { QuestionHistoryLegacy } from "./question-history-legacy";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { SiteDefinition } from '../shared/contracts';
import type { QuestionDetail, QuestionPage } from '../shared/question-history';
import { QUESTION_PANEL_BREAKPOINT, QUESTION_PANEL_WIDTH } from '../shared/question-layout';
import { ConfirmDialog } from './confirm-dialog';
import { CloseIcon } from './icons';
import { useGlobalFeedback } from './feedback-provider';
import { QuestionHistoryList } from './question-history-list';
import { QuestionHistoryReader } from './question-history-reader';
import { shell } from './shell-api';
import './question-history.css';
import { refreshQuestionPages } from './question-history-refresh';
import { focusableControls } from './focusable-controls';
import { guideComparisonChoices, type QuestionReadingRequest } from './question-reading-request';
import { usePresence } from './presence';
import { PANEL_EXIT_MS } from './motion';

type Confirmation = { title: string; message: string; label: string; run: () => void };
export function QuestionHistory({ open, active = true, copy, sites, draft, draftImageCount = 0, busy, onOpen, onClose, onDraft, onBlockingChange, onArchiveCreated, openRequest, onReadAccepted, onReadingCancelled, locale = navigator.language }: {
  open: boolean; copy: DesktopCopy; sites: readonly SiteDefinition[]; draft: string; draftImageCount?: number; busy: boolean;
  active?: boolean;
  onBlockingChange: (value: boolean) => void;
  onOpen: () => void; onClose: () => void; onDraft: (text: string) => void;
  onArchiveCreated?: (record: ArchiveRecord, mode: 'read' | 'compare', selection: { questionId: string; answerIds: readonly string[] }) => void; locale?: string;
  openRequest?: QuestionReadingRequest | null;
  onReadAccepted?: (questionId: string, request: number) => void;
  onReadingCancelled?: (request: number) => void;
}): React.JSX.Element | null {
  const { announce, setUndoAction } = useGlobalFeedback();
  const present = usePresence(open, PANEL_EXIT_MS, active);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<QuestionPage>({ items: [], cursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [detailView, setDetailView] = useState<QuestionDetailView | null>(null);
  const [readerNavigation, setReaderNavigation] = useState(0);
  const readerSession = useRef(new QuestionReaderSession());
  const [organizing, setOrganizing] = useState<string | null>(null);
  const archiveEpoch = useRef(0);
  const acceptedReading = useRef<string | null>(null);
  const [guideChoices, setGuideChoices] = useState<readonly string[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < QUESTION_PANEL_BREAKPOINT);
  const sequence = useRef(0), detailSequence = useRef(0), input = useRef<HTMLInputElement>(null);
  const listPending = useRef(0), detailPending = useRef(0);
  const pageRef = useRef(page); pageRef.current = page;
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const leaveDetail = useCallback(() => { detailSequence.current++; detailPending.current = 0; archiveEpoch.current++; setOrganizing(null); setGuideChoices([]); setDetail(null); setDetailView(null); }, []);
  const back = () => { if (openRequest?.source === 'guide') onReadingCancelled?.(openRequest.request); leaveDetail(); };
  const close = () => { sequence.current++; listPending.current = 0; detailSequence.current++; detailPending.current = 0; archiveEpoch.current++; closeRef.current(); };
  useLayoutEffect(() => {
    const saved = anchor.current; anchor.current = null;
    if (!saved || !scroll.current) return;
    const node = [...scroll.current.querySelectorAll<HTMLElement>('[data-question-id]')].find(n => n.dataset.questionId === saved.id);
    if (node) scroll.current.scrollTop += node.getBoundingClientRect().top - saved.top;
  }, [page]);
  const panel = useRef<HTMLElement>(null), opener = useRef<HTMLElement | null>(null);
  const full = narrow || !!detailView || !!confirmation || restoring;
  const lastFull = useRef(full); if (open) lastFull.current = full;
  const renderedFull = open ? full : lastFull.current;
  const covered = useRef(false);
  const disabled = busy || restoring;
  useEffect(() => { onBlockingChange(open && (!!confirmation || restoring || !!organizing)); return () => onBlockingChange(false); }, [open, confirmation, restoring, organizing, onBlockingChange]);
  useEffect(() => { if (busy || !open || !active) { archiveEpoch.current++; setOrganizing(null); } }, [busy, open, active]);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => shell.onQuestionSaveFailed(() => announce(copy.questionSaveFailed)), [copy, announce]);
  useEffect(() => {
    const resize = () => setNarrow(window.innerWidth < QUESTION_PANEL_BREAKPOINT);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => { sequence.current++; listPending.current = 0; detailSequence.current++; detailPending.current = 0; (document.querySelector<HTMLButtonElement>(".question-trigger") ?? opener.current)?.focus(); };
  }, [open]);
  useEffect(() => {
    const surface = questionHistorySurface(present, renderedFull);
    if (!surface) {
      leaveDetail(); setConfirmation(null);
      if (covered.current) { covered.current = false; if (active) shell.setSurface('sites'); }
      return;
    }
    covered.current = true;
    void shell.setQuestionPanel(!renderedFull).catch(() => announce(copy.questionFailed));
    shell.setSurface(surface);
    return () => { void shell.setQuestionPanel(false).catch(() => {}); };
  }, [present, renderedFull, active, copy, announce]);
  useEffect(() => {
    if (!open || confirmation || organizing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (e.isComposing || e.keyCode === 229)) { e.stopImmediatePropagation(); return; }
      // Portaled action menus handle Escape and Tab before the history surface.
      if (panel.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')) return;
      if (e.key === 'Escape') {
        const menu = panel.current?.querySelector<HTMLDetailsElement>('details[open]');
        e.preventDefault(); e.stopImmediatePropagation();
        if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
        else if (detailView) back();
        else close();
      }
      if (e.key === 'Tab' && full) {
        const nodes = panel.current ? focusableControls(panel.current) : [];
        if (!nodes.length) { e.preventDefault(); panel.current?.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!panel.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [open, detailView, confirmation, organizing, full, openRequest, onReadingCancelled]);
  const load = useCallback(async (cursor?: string, refresh = false) => {
    if (refresh && listPending.current) return;
    const request = ++sequence.current;
    listPending.current = request;
    setLoading(true); setError('');
    try {
      const result = refresh
        ? await refreshQuestionPages(filters => shell.listQuestions(filters), query, pageRef.current, () => request === sequence.current)
        : await shell.listQuestions({ query, cursor, limit: 50 });
      if (!result || request !== sequence.current) return;
      if (refresh && scroll.current) {
        const top = scroll.current.getBoundingClientRect().top;
        const node = [...scroll.current.querySelectorAll<HTMLElement>('[data-question-id]')].find(n => n.getBoundingClientRect().bottom > top);
        if (node) anchor.current = { id: node.dataset.questionId!, top: node.getBoundingClientRect().top };
      }
      setPage(old => ({ items: cursor ? [...old.items, ...result.items.filter(q => !old.items.some(a => a.id === q.id))] : result.items, cursor: result.cursor }));
    } catch { if (request === sequence.current) setError(copy.questionLoadFailed); }
    finally { if (listPending.current === request) listPending.current = 0; if (request === sequence.current) setLoading(false); }
  }, [query, copy]);
  useEffect(() => {
    if (!open) return;
    sequence.current++;
    const timer = setTimeout(() => { void load(); }, 200);
    return () => { clearTimeout(timer); sequence.current++; listPending.current = 0; };
  }, [open, load]);
  const read = async (id: string, answerId?: string, refresh = false, navigation?: number) => {
    if (refresh && detailPending.current) return;
    if (refresh && detailView?.state !== 'ready') return;
    const rememberedId = !answerId && !refresh ? readerSession.current.preferredAnswer(id) : undefined;
    answerId ??= rememberedId;
    const request = ++detailSequence.current;
    detailPending.current = request;
    setError('');
    if (!refresh) {
      if (detail?.question.id !== id) setDetail(null);
      setDetailView({ questionId: id, answerId, state: 'loading' });
    }
    try {
      let result: QuestionDetail | null;
      try { result = await shell.getQuestion(id, answerId); }
      catch (error) {
        if (!rememberedId || ipcErrorCode(error) !== 'history_not_found') throw error;
        if (request !== detailSequence.current) return;
        result = await shell.getQuestion(id);
        if (request !== detailSequence.current) return;
        if (result?.question.id === id) {
          answerId = readerSession.current.answer(result, readerSession.current.site(result));
          if (answerId && result.loadedAnswerId !== answerId) {
            setDetail(result); setDetailView({ questionId: id, answerId, state: 'loading' });
            result = await shell.getQuestion(id, answerId);
          }
        }
      }
      if (request !== detailSequence.current) return;
      if (!result) { setDetail(null); setDetailView({ questionId: id, answerId, state: 'missing' }); if (navigation !== undefined) onReadingCancelled?.(navigation); return; }
      if (result.question.id !== id || (answerId && result.loadedAnswerId !== answerId)) throw new Error('history_not_found');
      const requestedAnswer = answerId && result.answers.find(answer => answer.id === answerId);
      if (!refresh && requestedAnswer) readerSession.current.select(result, requestedAnswer.site, requestedAnswer.id);
      if (navigation !== undefined) setReaderNavigation(navigation);
      setDetail(result);
      setDetailView({ questionId: id, answerId: result.loadedAnswerId ?? answerId, state: 'ready' });
    } catch (error) { if (request === detailSequence.current) {
      setDetailView({ questionId: id, answerId, state: ipcErrorCode(error) === 'history_not_found' ? 'missing' : 'failed' });
      if (navigation !== undefined) onReadingCancelled?.(navigation);
    } }
    finally { if (detailPending.current === request) detailPending.current = 0; }
  };
  useEffect(() => {
    if (!open || confirmation || restoring || organizing) return;
    const timer = setInterval(() => {
      if (detailView) { if (detail) void read(detail.question.id, detail.loadedAnswerId ?? undefined, true); }
      else void load(undefined, true);
    }, 5_000);
    return () => clearInterval(timer);
  }, [open, detail?.question.id, detail?.loadedAnswerId, detailView?.state, confirmation, restoring, organizing, load, page.items.length]);
  useEffect(() => {
    if (open && openRequest) void read(openRequest.questionId, openRequest.answerId, false, openRequest.request);
  }, [open, openRequest?.request, openRequest?.questionId, openRequest?.answerId, openRequest?.source]);
  useEffect(() => {
    if (!open || !openRequest || !detailView || readerNavigation !== openRequest.request) return;
    if (detailView.state === 'failed' || detailView.state === 'missing') { onReadingCancelled?.(openRequest.request); return; }
    if (busy || restoring || detailView.state !== 'ready' || detail?.question.id !== openRequest.questionId ||
      detail.loadedAnswerId !== openRequest.answerId) return;
    const answer = detail.answers.find(item => item.id === openRequest.answerId);
    if (!answer?.answerMarkdown?.trim()) { onReadingCancelled?.(openRequest.request); return; }
    const identity = `${openRequest.source ?? 'progress'}:${openRequest.request}:${openRequest.questionId}`;
    if (acceptedReading.current === identity) return;
    acceptedReading.current = identity;
    if (openRequest.source === 'guide' && openRequest.mode === 'compare') {
      const choices = guideComparisonChoices(detail, openRequest);
      if (choices.length !== 2) { onReadingCancelled?.(openRequest.request); return; }
      archiveEpoch.current++; setGuideChoices(choices); setOrganizing(answer.id);
    } else onReadAccepted?.(openRequest.questionId, openRequest.request);
  }, [open, openRequest, readerNavigation, detail, detailView, busy, restoring, onReadAccepted, onReadingCancelled]);
  useEffect(() => {
    if (!open) return;
    if (detail) panel.current?.querySelector<HTMLButtonElement>('.question-header button')?.focus();
    else input.current?.focus();
  }, [open, detail?.question.id]);
  const reask = (text: string, imageCount = 0) => {
    const apply = () => { onDraft(text); setConfirmation(null); close(); };
    const warning = questionReaskWarning(draft, draftImageCount, text, imageCount, copy);
    if (warning) setConfirmation({ title: copy.questionDraftTitle, message: warning, label: copy.questionReask, run: apply });
    else apply();
  };
  const remove = (id: string) => setConfirmation({ title: copy.questionDeleteTitle, message: copy.questionDeleteWarning, label: copy.questionDelete, run: () => {
    detailSequence.current++; detailPending.current = 0;
    void shell.deleteQuestion(id).then(() => {
      if (detail?.question.id === id) leaveDetail();
      sequence.current++; listPending.current = 0;
      void load(undefined, true); announce(copy.questionDeleted);
    }).catch(() => setError(copy.questionFailed)).finally(() => setConfirmation(null));
  } });
  const restore = async (id: string, answerId?: string) => {
    if (disabled) return;
    const request = ++detailSequence.current; detailPending.current = request;
    setError('');
    try {
      const preview = await shell.previewQuestion(id, answerId);
      if (request !== detailSequence.current) return;
      const execute = async () => {
        if (request !== detailSequence.current) return;
        setConfirmation(null); setRestoring(true); announce(copy.questionBusy);
        setUndoAction({ label: copy.cancel, run: () => { void shell.cancelQuestionRestore(); } });
        try {
          const result = await shell.restoreQuestion(preview.token, true);
          if (request !== detailSequence.current) return;
          const labels = { opened: copy.questionOpened, already_open: copy.questionAlreadyOpen, missing_url: copy.questionNoUrl,
            failed: copy.questionOpenFailed, timeout: copy.questionTimeout, cancelled: copy.questionCancelled };
          announce(result.map(r => `${sites.find(s => s.key === r.site)?.label ?? r.site}: ${labels[r.state]}`).join(' · '));
          setUndoAction({ label: copy.questionCopies, run: () => { onOpen(); void read(id); } });
          if (result.every(r => r.state === 'opened' || r.state === 'already_open')) { close(); }
          else { onOpen(); await read(id); }
        } catch { if (request === detailSequence.current) { setUndoAction(null); setError(copy.questionFailed); announce(copy.questionFailed); } }
        finally { setRestoring(false); }
      };
      if (preview.needsConfirmation) setConfirmation({ title: copy.questionRestoreTitle, message: `${copy.questionRestoreWarning}\n${preview.affected.map(key => sites.find(s => s.key === key)?.label ?? key).join(' / ')}`, label: copy.questionRestore, run: () => { void execute(); } });
      else await execute();
    } catch { if (request === detailSequence.current) setError(copy.questionFailed); }
    finally { if (detailPending.current === request) detailPending.current = 0; }
  };
  if (!present) return null;
  return <aside ref={panel} tabIndex={-1} className={`question-history${renderedFull ? ' is-full' : ''}`} style={{ width: renderedFull ? undefined : QUESTION_PANEL_WIDTH }}
    data-state={open ? 'open' : 'closed'} inert={!open} aria-hidden={open ? undefined : true} aria-label={copy.questionHistory}>
    <header className="question-header"><h1>{detailView ? copy.questionCopies : copy.questionHistory}</h1>
      {detailView && <button type="button" onClick={back}>{copy.questionBack}</button>}
      <button className="panel-close" type="button" aria-label={copy.questionClose} data-hint={copy.questionClose} onClick={close}><CloseIcon /></button>
    </header>
    {restoring && <div role="status" className="question-notice">{copy.questionBusy} <button type="button" onClick={() => { void shell.cancelQuestionRestore(); }}>{copy.cancel}</button></div>}
    {error && <div role="alert" className="question-notice">{error} <button type="button" onClick={() => { if (detail) void read(detail.question.id, detail.loadedAnswerId ?? undefined); else void load(undefined, true); }}>{copy.questionRetry}</button></div>}
    {detail ? <QuestionHistoryReader key={`reader:${detail.question.id}:${readerNavigation}`} detail={detail} view={detailView ?? undefined} session={readerSession.current} copy={copy} sites={sites} busy={disabled} onLoadAnswer={answerId => { void read(detail.question.id, answerId); }} onRestore={answerId => { void restore(detail.question.id, answerId); }} onReask={() => reask(detail.question.text, detail.question.inputImageCount)} onDelete={() => remove(detail.question.id)} onAnnounce={announce} onOrganize={answerId => { if (!disabled && detailView?.state === 'ready') { archiveEpoch.current++; setOrganizing(answerId); } }} /> : detailView ? <div className="question-detail-state question-empty">
      <p data-state={detailView.state} role={detailView.state === 'failed' ? 'alert' : 'status'}>{detailView.state === 'loading' ? copy.questionDetailLoading : detailView.state === 'missing' ? copy.questionRecordMissing : copy.questionDetailFailed}</p>
      {detailView.state !== 'loading' && <button type="button" onClick={() => { void read(detailView.questionId, detailView.answerId); }}>{copy.questionRetry}</button>}
    </div> : <>
      <div className="question-search"><input ref={input} type="search" value={query} onChange={e => { leaveDetail(); sequence.current++; listPending.current = 0; setQuery(e.target.value); }} aria-label={copy.questionSearch} placeholder={copy.questionSearch} /></div>
      <div ref={scroll} className="question-scroll" aria-busy={loading}>
        {loading && !page.items.length ? <p className="question-empty" role="status">{copy.questionLoading}</p> : !error && !page.items.length && <p className="question-empty">{query ? copy.questionNoResults : copy.questionEmpty}</p>}
        <QuestionHistoryList items={page.items} sites={sites} copy={copy} busy={disabled} onRestore={id => { void restore(id); }} onRead={id => { void read(id); }} onReask={reask} onDelete={remove} />
        {page.cursor && <button type="button" className="question-load-more" disabled={loading} onClick={() => { void load(page.cursor!); }}>{copy.questionMore}</button>}
        <QuestionHistoryLegacy query={query} copy={copy} busy={disabled} onReask={reask} />
      </div>
    </>}
    {confirmation && <ConfirmDialog copy={copy} title={confirmation.title} message={confirmation.message} confirmLabel={confirmation.label} cancelLabel={copy.cancel} onConfirm={confirmation.run} onCancel={() => setConfirmation(null)} />}
    {organizing && detail && <QuestionArchivePicker key={`picker:${detail.question.id}:${archiveEpoch.current}`} detail={detail} answerId={organizing} initialAnswerIds={guideChoices}
      copy={copy} sites={sites} busy={disabled} locale={resolveLocale(locale) === 'zhCN' ? 'zh-CN' : resolveLocale(locale) === 'zhTW' ? 'zh-TW' : 'en'}
      onCancel={() => { archiveEpoch.current++; setOrganizing(null); setGuideChoices([]); if (openRequest) onReadingCancelled?.(openRequest.request); }} onCreated={(record, mode, selection) => {
        setOrganizing(null); announce(copy.questionArchiveSaved); onArchiveCreated?.(record, mode, selection);
      }} />}
  </aside>;
}
