import { questionHistorySurface } from "./question-history-model";
import { QuestionHistoryLegacy } from "./question-history-legacy";
import { useCallback, useEffect, useRef, useState } from 'react';
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

type Confirmation = { title: string; message: string; label: string; run: () => void };
export function QuestionHistory({ open, copy, sites, draft, busy, onOpen, onClose, onDraft, onBlockingChange }: {
  open: boolean; copy: DesktopCopy; sites: readonly SiteDefinition[]; draft: string; busy: boolean;
  onBlockingChange: (value: boolean) => void;
  onOpen: () => void; onClose: () => void; onDraft: (text: string) => void;
}): React.JSX.Element | null {
  const { announce, setUndoAction } = useGlobalFeedback();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<QuestionPage>({ items: [], cursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [narrow, setNarrow] = useState(() => window.innerWidth < QUESTION_PANEL_BREAKPOINT);
  const sequence = useRef(0), detailSequence = useRef(0), input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null), opener = useRef<HTMLElement | null>(null);
  const full = narrow || !!detail || !!confirmation || restoring;
  const disabled = busy || restoring;
  useEffect(() => { onBlockingChange(!!confirmation || restoring); return () => onBlockingChange(false); }, [confirmation, restoring, onBlockingChange]);
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
    return () => { sequence.current++; detailSequence.current++; (document.querySelector<HTMLButtonElement>(".question-trigger") ?? opener.current)?.focus(); };
  }, [open]);
  useEffect(() => {
    const surface = questionHistorySurface(open, full);
    if (!surface) { setDetail(null); setConfirmation(null); return; }
    void shell.setQuestionPanel(!full).catch(() => announce(copy.questionFailed));
    shell.setSurface(surface);
    return () => { void shell.setQuestionPanel(false).catch(() => {}); };
  }, [open, full, copy, announce]);
  useEffect(() => {
    if (!open || confirmation) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const menu = panel.current?.querySelector<HTMLDetailsElement>('details[open]');
        e.preventDefault(); e.stopImmediatePropagation();
        if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
        else if (detail) setDetail(null);
        else closeRef.current();
      }
      if (e.key === 'Tab' && full) {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [open, detail, confirmation, full]);
  const load = useCallback(async (cursor?: string) => {
    const request = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await shell.listQuestions({ query, cursor, limit: 50 });
      if (request !== sequence.current) return;
      setPage(old => ({ items: cursor ? [...old.items, ...result.items.filter(q => !old.items.some(a => a.id === q.id))] : result.items, cursor: result.cursor }));
    } catch { if (request === sequence.current) setError(copy.questionLoadFailed); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [query, copy]);
  useEffect(() => {
    if (!open) return;
    sequence.current++;
    const timer = setTimeout(() => { void load(); }, 200);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [open, load]);
  const read = async (id: string, answerId?: string) => {
    const request = ++detailSequence.current;
    setError('');
    try {
      const result = await shell.getQuestion(id, answerId);
      if (request !== detailSequence.current) return;
      if (!result) { setDetail(null); setError(copy.questionDeleted); announce(copy.questionDeleted); void load(); return; }
      setDetail(result);
    } catch { if (request === detailSequence.current) setError(copy.questionLoadFailed); }
  };
  useEffect(() => {
    if (!open || confirmation || restoring) return;
    const timer = setInterval(() => {
      if (detail) void read(detail.question.id, detail.loadedAnswerId ?? undefined);
      else if (page.items.length <= 50) void load();
    }, 5_000);
    return () => clearInterval(timer);
  }, [open, detail?.question.id, detail?.loadedAnswerId, confirmation, restoring, load, page.items.length]);
  useEffect(() => {
    if (!open) return;
    if (detail) panel.current?.querySelector<HTMLButtonElement>('.question-header button')?.focus();
    else input.current?.focus();
  }, [open, detail?.question.id]);
  const reask = (text: string) => {
    const apply = () => { onDraft(text); setConfirmation(null); setDetail(null); onClose(); };
    if (draft.trim() && draft !== text) setConfirmation({ title: copy.questionDraftTitle, message: copy.questionDraftWarning, label: copy.questionReask, run: apply });
    else apply();
  };
  const remove = (id: string) => setConfirmation({ title: copy.questionDeleteTitle, message: copy.questionDeleteWarning, label: copy.questionDelete, run: () => {
    setConfirmation(null);
    void shell.deleteQuestion(id).then(() => { if (detail?.question.id === id) setDetail(null); void load(); announce(copy.questionDeleted); }).catch(() => setError(copy.questionFailed));
  } });
  const restore = async (id: string, answerId?: string) => {
    if (disabled) return;
    setError('');
    try {
      const preview = await shell.previewQuestion(id, answerId);
      const execute = async () => {
        setConfirmation(null); setRestoring(true); announce(copy.questionBusy);
        setUndoAction({ label: copy.cancel, run: () => { void shell.cancelQuestionRestore(); } });
        try {
          const result = await shell.restoreQuestion(preview.token, true);
          const labels = { opened: copy.questionOpened, already_open: copy.questionAlreadyOpen, missing_url: copy.questionNoUrl,
            failed: copy.questionOpenFailed, timeout: copy.questionTimeout, cancelled: copy.questionCancelled };
          announce(result.map(r => `${sites.find(s => s.key === r.site)?.label ?? r.site}: ${labels[r.state]}`).join(' · '));
          setUndoAction({ label: copy.questionCopies, run: () => { onOpen(); void read(id); } });
          if (result.every(r => r.state === 'opened' || r.state === 'already_open')) { setDetail(null); onClose(); }
          else { onOpen(); await read(id); }
        } catch { setUndoAction(null); setError(copy.questionFailed); announce(copy.questionFailed); }
        finally { setRestoring(false); }
      };
      if (preview.needsConfirmation) setConfirmation({ title: copy.questionRestoreTitle, message: `${copy.questionRestoreWarning}\n${preview.affected.map(key => sites.find(s => s.key === key)?.label ?? key).join(' / ')}`, label: copy.questionRestore, run: () => { void execute(); } });
      else await execute();
    } catch { setError(copy.questionFailed); }
  };
  if (!open) return null;
  return <aside ref={panel} className={`question-history${full ? ' is-full' : ''}`} style={{ width: full ? undefined : QUESTION_PANEL_WIDTH }} aria-label={copy.questionHistory}>
    <header className="question-header"><h1>{detail ? copy.questionCopies : copy.questionHistory}</h1>
      {detail && <button type="button" onClick={() => setDetail(null)}>{copy.questionBack}</button>}
      <button className="panel-close" type="button" aria-label={copy.questionClose} data-hint={copy.questionClose} onClick={onClose}><CloseIcon /></button>
    </header>
    {restoring && <div role="status" className="question-notice">{copy.questionBusy} <button type="button" onClick={() => { void shell.cancelQuestionRestore(); }}>{copy.cancel}</button></div>}
    {error && <div role="alert" className="question-notice">{error} <button type="button" onClick={() => { if (detail) void read(detail.question.id, detail.loadedAnswerId ?? undefined); else void load(); }}>{copy.questionRetry}</button></div>}
    {detail ? <QuestionHistoryReader detail={detail} copy={copy} sites={sites} busy={disabled} onLoadAnswer={answerId => { void read(detail.question.id, answerId); }} onRestore={answerId => { void restore(detail.question.id, answerId); }} onReask={() => reask(detail.question.text)} onDelete={() => remove(detail.question.id)} onAnnounce={announce} /> : <>
      <div className="question-search"><input ref={input} type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={copy.questionSearch} placeholder={copy.questionSearch} /></div>
      <div className="question-scroll" aria-busy={loading}>
        {loading && !page.items.length ? <p className="question-empty" role="status">{copy.questionLoading}</p> : !error && !page.items.length && <p className="question-empty">{query ? copy.questionNoResults : copy.questionEmpty}</p>}
        <QuestionHistoryList items={page.items} sites={sites} copy={copy} busy={disabled} onRestore={id => { void restore(id); }} onRead={id => { void read(id); }} onReask={reask} onDelete={remove} />
        {page.cursor && <button type="button" className="question-load-more" disabled={loading} onClick={() => { void load(page.cursor!); }}>{copy.questionMore}</button>}
        <QuestionHistoryLegacy query={query} copy={copy} busy={disabled} onReask={reask} />
      </div>
    </>}
    {confirmation && <ConfirmDialog copy={copy} title={confirmation.title} message={confirmation.message} confirmLabel={confirmation.label} cancelLabel={copy.cancel} onConfirm={confirmation.run} onCancel={() => setConfirmation(null)} />}
  </aside>;
}
