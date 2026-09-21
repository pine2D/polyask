import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { QuestionLegacyPage } from '../shared/question-history';
import { shell } from './shell-api';
export function QuestionHistoryLegacy({ query, copy, busy, onReask }: { query: string; copy: DesktopCopy; busy: boolean; onReask: (text: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [page, setPage] = useState<QuestionLegacyPage>({ items: [], cursor: null });
  const sequence = useRef(0);
  const load = async (cursor?: string) => {
    const request = ++sequence.current; setLoading(true); setError(false);
    try {
      const result = await shell.listLegacyQuestions({ query, cursor });
      if (request === sequence.current) setPage(old => ({ items: cursor ? [...old.items, ...result.items] : result.items, cursor: result.cursor }));
    } catch { if (request === sequence.current) setError(true); }
    finally { if (request === sequence.current) setLoading(false); }
  };
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void load(); }, 200);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [open, query]);
  return <details className="question-legacy" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{copy.questionLegacy}</summary><p>{copy.questionLegacyNote}</p>
    {error && <p role="alert">{copy.questionLoadFailed}<button type="button" onClick={() => { void load(); }}>{copy.questionRetry}</button></p>}
    {page.items.map(q => <button type="button" disabled={busy} key={q.id} onClick={() => onReask(q.text)}>{q.text}</button>)}
    {page.cursor && <button type="button" disabled={loading} onClick={() => { void load(page.cursor!); }}>{copy.questionMore}</button>}
  </details>;
}
