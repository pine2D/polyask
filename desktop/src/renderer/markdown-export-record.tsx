import { useId, useLayoutEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { markdownTargetKey, type MarkdownDocument, type MarkdownEntry } from '../shared/markdown-export';
import { markdownGroups, markdownChosen, markdownSelectionState, type MarkdownChoices, type CheckState } from './markdown-export-model';
export function MarkdownCheckbox({ state, label, disabled, onChange }: { state: CheckState; label: string; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.indeterminate = state === 'mixed'; }, [state]);
  return <input ref={ref} type="checkbox" checked={state === true} aria-checked={state} aria-label={label} disabled={disabled} onChange={onChange} />;
}
function stateLabel(entry: MarkdownEntry, copy: DesktopCopy): string {
  if (!entry.available) return copy.questionNoAnswer;
  if (entry.truncated) return copy.questionTruncated;
  if (entry.state === 'complete') return copy.questionStateComplete;
  if (entry.state === 'partial') return copy.questionStatePartial;
  if (entry.state === 'interrupted') return copy.questionStateInterrupted;
  return copy.reportUnverified;
}
export function MarkdownExportRecord({ document: doc, selection, copy, disabled, onToggle, onVersion, onAll }: {
  document: MarkdownDocument; selection: MarkdownChoices; copy: DesktopCopy; disabled: boolean;
  onToggle: (key: string, id: string) => void; onVersion: (key: string, id: string) => void; onAll: (doc: MarkdownDocument, checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true), id = useId(), key = markdownTargetKey(doc.target), choice = selection[key];
  const groups = markdownGroups(doc), total = groups.filter(g => g.entries.some(e => e.available)).length;
  const count = groups.filter(g => g.entries.some(e => choice?.selected.includes(e.id))).length;
  const state = markdownSelectionState([doc], selection);
  const warning = doc.entries.some(e => e.kind === 'synthesis' && choice?.selected.includes(e.id))
    && doc.entries.some(e => e.kind === 'answer' && !choice?.selected.includes(e.id));
  return <section className="markdown-export-record">
    <div className="markdown-export-record-heading">
      <MarkdownCheckbox state={state} label={doc.title} disabled={disabled || !total} onChange={() => onAll(doc, state !== true)} />
      <button type="button" className="markdown-export-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d={expanded ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        <span>{doc.title}</span>
      </button>
      <span className="markdown-export-group-count">{formatCopy(copy.markdownGroupCount, { selected: count, total })}</span>
    </div>
    <div id={id} hidden={!expanded} className="markdown-export-entries">
      {groups.map(group => {
        const entry = markdownChosen(group, choice) ?? group.entries.at(-1)!, selected = !!choice?.selected.includes(entry.id);
        return <div className="markdown-export-entry" key={group.key}>
          <label><input type="checkbox" checked={selected} disabled={disabled || !entry.available} onChange={() => onToggle(key, entry.id)} />
            <span>{entry.kind === 'synthesis' ? copy.markdownSynthesis : entry.label}</span></label>
          {doc.target.kind === 'history' && <select aria-label={`${entry.label} · ${copy.markdownVersion}`} value={entry.id} disabled={disabled || !entry.available}
            onChange={event => onVersion(key, event.target.value)}>
            {[...group.entries].sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0)).map(e => <option key={e.id} value={e.id} disabled={!e.available}>
              {formatCopy(copy.questionAttempt, { number: e.attempt ?? 1 })}{!e.available ? ` · ${copy.questionNoAnswer}` : ''}</option>)}
          </select>}
          <span className="markdown-export-entry-note">{stateLabel(entry, copy)}
            {entry.available && entry.latestAttempt !== undefined && (entry.attempt ?? 0) < entry.latestAttempt &&
              !group.entries.some(e => e.attempt === entry.latestAttempt && e.available) && ` · ${copy.markdownFallback}`}</span>
        </div>;
      })}
      {warning && <p className="markdown-export-warning" role="note">{copy.markdownSynthesisWarning}</p>}
    </div>
  </section>;
}
