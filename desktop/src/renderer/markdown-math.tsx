import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { getCopy } from '../shared/copy';
import { mathSourceIssue, type MathFailure } from './math-source';
import { renderMath } from './math-renderer';
import { mathmlNodes, type MathNode } from './mathml-nodes';

function elements(nodes: readonly (MathNode | string)[]): ReactNode[] {
  return nodes.map((node, key) => typeof node === 'string' ? node : createElement(node.name, { ...node.attributes, key }, elements(node.children)));
}
export function MarkdownMath({ source, literal, display, block = false }: {
  readonly source: string; readonly literal: string; readonly display: boolean; readonly block?: boolean;
}): React.JSX.Element {
  const copy = getCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
  const [preview, setPreview] = useState<{ source: string; display: boolean; nodes: readonly MathNode[] } | null>(null);
  const [status, setStatus] = useState<MathFailure | 'pending' | null>(null);
  const [showSource, setShowSource] = useState(true);
  const controller = useRef<AbortController | null>(null), revision = useRef(0), active = useRef(true), pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; revision.current++; controller.current?.abort(); }; }, []);
  useEffect(() => {
    revision.current++; controller.current?.abort(); pending.current = false;
    setPreview(null); setStatus(null); setShowSource(true);
  }, [source, display]);
  const issue = mathSourceIssue(source), current = preview?.source === source && preview.display === display ? preview : null;
  const failure = issue ?? status;
  const messages = { limit: copy.readingFormulaLimit, unsupported: copy.readingFormulaUnsupported, busy: copy.readingFormulaBusy,
    timeout: copy.readingFormulaTimeout, failed: copy.readingFormulaFailed, pending: copy.readingFormulaLoading };
  const requestPreview = async () => {
    if (issue || pending.current) return;
    pending.current = true;
    const request = ++revision.current, abort = new AbortController(); controller.current = abort;
    setStatus('pending');
    const result = await renderMath(source, display, abort.signal);
    if (!active.current || request !== revision.current || abort.signal.aborted) return;
    pending.current = false;
    if (!result.ok) { setStatus(result.reason); return; }
    const nodes = mathmlNodes(result.mathml);
    if (!nodes) { setStatus('failed'); return; }
    setPreview({ source, display, nodes }); setStatus(null); setShowSource(false);
  };
  const code = <code className="markdown-math-source">{literal}</code>;
  return createElement(block ? 'figure' : 'span', { className: `markdown-math${block ? ' markdown-math-block' : ''}`, 'aria-label': copy.readingFormula },
    <span className="markdown-math-actions">
      <button type="button" disabled={!!issue || status === 'pending'} onClick={() => void requestPreview()}>{copy.readingFormulaPreview}</button>
      {current && <button type="button" aria-pressed={showSource} onClick={() => setShowSource(value => !value)}>{copy.readingFormulaSource}</button>}
    </span>,
    current && <span className="markdown-math-preview">{elements(current.nodes)}</span>,
    block ? <pre hidden={!!current && !showSource}>{code}</pre> : <span hidden={!!current && !showSource}>{code}</span>,
    <span role="status" aria-live="polite">{failure ? messages[failure] : ''}</span>);
}
