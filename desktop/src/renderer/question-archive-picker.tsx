import { useEffect, useRef, useState } from 'react';
import type { ArchiveRecord } from '../shared/archive';
import type { SiteDefinition } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { ipcErrorCode } from '../shared/ipc-error';
import type { QuestionArchiveLocale } from '../shared/question-archive';
import type { QuestionAnswerRecord, QuestionDetail } from '../shared/question-history';
import { answerState } from './question-history-model';
import { FolderModal } from './folder-modal';
import { shell } from './shell-api';

// 未载入的正文是 null；capturedAt 是数据库已保存正文的元数据，最终仍由主进程核对。
const available = (answer: QuestionAnswerRecord) => answer.capturedAt !== null && answer.capture !== 'unavailable';
export function QuestionArchivePicker({ detail, answerId, copy, sites, locale, busy, onCancel, onCreated }: {
  detail: QuestionDetail; answerId: string; copy: DesktopCopy; sites: readonly SiteDefinition[];
  locale: QuestionArchiveLocale; busy: boolean; onCancel: () => void;
  onCreated: (record: ArchiveRecord, mode: 'read' | 'compare') => void;
}): React.JSX.Element {
  const [source, setSource] = useState(detail);
  const [selected, setSelected] = useState<string[]>(() => {
    const answer = detail.answers.find(a => a.id === answerId);
    return answer && available(answer) && answer.answerMarkdown?.trim() ? [answer.id] : [];
  });
  const [saving, setSaving] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false), epoch = useRef(0), mounted = useRef(true);
  const latest = useRef({ busy, onCreated }); latest.current = { busy, onCreated };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; epoch.current++; };
  }, []);
  const locked = busy || saving || loading;
  const answers = source.question.sites.flatMap(site => source.answers.filter(a => a.site === site && selected.includes(a.id)));
  const choose = (site: string, id: string) => {
    setSelected(current => [...current.filter(value => source.answers.find(a => a.id === value)?.site !== site), ...(id ? [id] : [])]);
  };
  const save = async (mode: 'read' | 'compare') => {
    if (pending.current || latest.current.busy || answers.length < (mode === 'compare' ? 2 : 1) || answers.length > 9) return;
    pending.current = true; const request = ++epoch.current;
    setSaving(true); setError('');
    try {
      const record = await shell.createQuestionArchive({ questionId: source.question.id, locale,
        answers: answers.map(answer => ({ answerId: answer.id, updatedAt: answer.updatedAt })) });
      if (mounted.current && request === epoch.current && !latest.current.busy) latest.current.onCreated(record, mode);
    } catch (reason) {
      if (mounted.current && request === epoch.current) {
        const code = ipcErrorCode(reason);
        setError(code === 'history_not_found' ? copy.questionCopyChanged : code === 'no_answer' ? copy.questionNoAnswer : copy.questionFailed);
      }
    } finally {
      pending.current = false;
      if (mounted.current && request === epoch.current) setSaving(false);
    }
  };
  const refresh = async () => {
    if (pending.current || latest.current.busy) return;
    pending.current = true; const request = ++epoch.current;
    setLoading(true);
    try {
      const next = await shell.getQuestion(source.question.id);
      if (!mounted.current || request !== epoch.current) return;
      if (!next || next.question.id !== source.question.id) { setError(copy.questionRecordMissing); setSelected([]); return; }
      setSource(next); setSelected([]); setError('');
    } catch { if (mounted.current && request === epoch.current) setError(copy.questionDetailFailed); }
    finally { pending.current = false; if (mounted.current && request === epoch.current) setLoading(false); }
  };
  return <div className="question-archive-picker"><FolderModal copy={copy} title={copy.questionArchiveTitle} busy={saving || loading} onCancel={onCancel}>
    <p>{copy.questionArchiveHint}</p><p id="question-archive-rule">{copy.questionArchiveOnePerSite}</p>
    <div className="question-archive-choices" aria-describedby="question-archive-rule">
      {source.question.sites.map(site => <label key={site} data-archive-site={site}>
        <span>{sites.find(item => item.key === site)?.label ?? site}</span>
        <select aria-label={sites.find(item => item.key === site)?.label ?? site} disabled={locked}
          value={answers.find(answer => answer.site === site)?.id ?? ''} onChange={event => choose(site, event.target.value)}>
          <option value="">{copy.questionArchiveNone}</option>
          {source.answers.filter(answer => answer.site === site).map(answer => <option key={answer.id} value={answer.id} disabled={!available(answer)}>
            {[formatCopy(copy.questionAttempt, { number: answer.attempt }), answerState(answer, copy),
              answer.capturedAt === null ? '' : formatCopy(copy.questionCaptured, { time: new Date(answer.capturedAt).toLocaleString(locale) })].filter(Boolean).join(' · ')}
          </option>)}
        </select>
      </label>)}
    </div>
    <p className="library-selection-count">{formatCopy(copy.questionArchiveSelected, { count: answers.length })}</p>
    {error && <p role="alert">{error}</p>}
    {saving || loading ? <p role="status">{saving ? copy.questionArchiveSaving : copy.questionDetailLoading}</p> : null}
    {error && <button type="button" data-question-archive="refresh" disabled={locked} onClick={() => { void refresh(); }}>{copy.questionArchiveRefresh}</button>}
    {answers.length < 2 && <p className="question-note">{copy.questionArchiveCompareHint}</p>}
    <div className="confirm-actions">
      <button type="button" disabled={saving || loading} onClick={onCancel}>{copy.cancel}</button>
      <button type="button" data-question-archive="read" disabled={locked || !answers.length || answers.length > 9} onClick={() => { void save('read'); }}>{copy.questionArchiveRead}</button>
      <button type="button" data-question-archive="compare" className="primary" disabled={locked || answers.length < 2 || answers.length > 9} onClick={() => { void save('compare'); }}>{copy.questionArchiveCompare}</button>
    </div>
  </FolderModal></div>;
}
