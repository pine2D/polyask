import { useEffect, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { MAX_MARKDOWN_RECORDS } from '../shared/markdown-export';
import type { QuestionSummary } from '../shared/question-history';
import { MarkdownCheckbox } from './markdown-export-record';
export function useQuestionHistorySelection(open: boolean, copy: DesktopCopy, announce: (message: string) => void) {
  const [selecting, setSelecting] = useState(false), [ids, setIds] = useState<readonly string[]>([]);
  const clear = () => setIds([]);
  const finish = () => { setSelecting(false); clear(); };
  useEffect(() => { if (!open) finish(); }, [open]);
  const choose = (next: readonly string[]) => {
    if (next.length > MAX_MARKDOWN_RECORDS) { announce(copy.markdownTooMany); return; }
    setIds(next);
  };
  return { selecting, ids, clear, finish, start: () => setSelecting(true), remove: (id: string) => setIds(old => old.filter(value => value !== id)),
    toggle: (id: string) => choose(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]),
    loaded: (items: readonly QuestionSummary[]) => {
      const loaded = items.map(q => q.id), all = loaded.every(id => ids.includes(id));
      choose(all ? ids.filter(id => !loaded.includes(id)) : [...new Set([...ids, ...loaded])]);
    } };
}
export function QuestionHistorySelection({ copy, items, ids, disabled, onLoaded, onClear, onExport }: {
  copy: DesktopCopy; items: readonly QuestionSummary[]; ids: readonly string[]; disabled: boolean;
  onLoaded: () => void; onClear: () => void; onExport: () => void;
}) {
  const visible = items.filter(q => ids.includes(q.id)).length, hidden = ids.length - visible;
  const state = !visible ? false : visible === items.length ? true : 'mixed';
  return <div className="question-selection">
    <div role="status"><strong>{formatCopy(copy.markdownSelected, { count: ids.length })}</strong>
      {hidden > 0 && <span> · {formatCopy(copy.markdownHidden, { count: hidden })}</span>}</div>
    <div className="question-selection-actions">
      <label><MarkdownCheckbox state={state} label={copy.markdownLoaded} disabled={disabled || !items.length} onChange={onLoaded} />{copy.markdownLoaded}</label>
      <button type="button" disabled={disabled || !ids.length} onClick={onClear}>{copy.markdownClear}</button>
      <button type="button" className="primary" disabled={disabled || !ids.length} onClick={onExport}>{copy.markdownMerge}</button>
    </div><p>{copy.markdownLimit}</p>
  </div>;
}
