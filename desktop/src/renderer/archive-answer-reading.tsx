import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import { answerSourceId } from '../shared/answer-source';
import { displayedExcerpt, uniqueExcerpt, type ExactExcerpt, type ExcerptSource } from './answer-excerpt';
import { FolderModal } from './folder-modal';

export function ArchiveAnswerReading(props: {
  readonly copy: DesktopCopy;
  readonly source: ExcerptSource;
  readonly busy?: boolean;
  readonly children: React.ReactNode;
  readonly onEvidence?: (value: ExactExcerpt) => void;
  readonly onFollowUp?: (value: ExactExcerpt) => void;
  readonly onCompare?: (value: ExactExcerpt) => void;
}): React.JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ExactExcerpt | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawSelection, setRawSelection] = useState<ExactExcerpt | null>(null);
  const [renderedHint, setRenderedHint] = useState('');
  const source = props.source;
  useEffect(() => { setSelected(null); setRawOpen(false); setRawSelection(null); setRenderedHint(''); },
    [source.archiveId, source.sourceUpdatedAt, source.resultIndex, source.host, source.sourceText]);
  const openRaw = (hint = '') => { setRenderedHint(hint); setRawSelection(null); setRawOpen(true); };
  const readSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0), node = body.current;
    if (!node?.contains(range.startContainer) || !node.contains(range.endContainer)) return;
    const element = range.startContainer.parentElement;
    if (element?.closest('button, a, input, textarea, svg, figcaption, .mermaid-canvas, .markdown-math-preview, .markdown-code-notice, .mermaid-notice, .sr-only')) return;
    const text = selection.toString();
    if (!text.trim()) return;
    // 只将同一文本节点中唯一的原文字面片段直接入选；跨格式或重复文本需人工核对。
    const exact = range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE
      ? uniqueExcerpt(source, text) : null;
    if (exact) { setSelected(exact); setRawOpen(false); } else openRaw(text);
  };
  const canUseEvidence = !!selected && [...selected.excerpt].length <= 4000;
  return <div className="archive-answer-reading">
    <div className="archive-answer-reading-body" ref={body} onPointerUp={readSelection}>{props.children}</div>
    <button className="answer-excerpt-open" type="button" onClick={() => openRaw()}>{props.copy.excerptSelectOriginal}</button>
    {selected ? <div className="answer-excerpt-actions" onPointerDown={event => event.preventDefault()}>
      <strong>{answerSourceId(source.resultIndex)} {source.label}</strong>
      {source.truncated ? <p className="answer-capture-warning">{props.copy.answerTruncated}</p> : null}
      <blockquote>{selected.excerpt}</blockquote>
      <div>
        {props.onEvidence ? <button type="button" disabled={props.busy || !canUseEvidence} onClick={() => props.onEvidence?.(selected)}>{props.copy.excerptUseEvidence}</button> : null}
        {props.onFollowUp ? <button type="button" disabled={props.busy} onClick={() => props.onFollowUp?.(selected)}>{props.copy.excerptFollowUp}</button> : null}
        {props.onCompare ? <button type="button" disabled={props.busy || !canUseEvidence} onClick={() => props.onCompare?.(selected)}>{props.copy.excerptManualCompare}</button> : null}
        <button type="button" onClick={() => setSelected(null)}>{props.copy.excerptClear}</button>
      </div>
      {!canUseEvidence ? <p role="status">{props.copy.excerptEvidenceLimit}</p> : null}
    </div> : null}
    {rawOpen ? <FolderModal copy={props.copy} title={props.copy.excerptReviewOriginal} busy={false} onCancel={() => setRawOpen(false)}>
      <p>{answerSourceId(source.resultIndex)} {source.label} · {props.copy.excerptOriginalHint}</p>
      {renderedHint ? <blockquote className="excerpt-rendered-hint">{renderedHint}</blockquote> : null}
      <textarea name="answer-excerpt-original" aria-label={props.copy.excerptOriginal} readOnly value={source.sourceText}
        onSelect={event => setRawSelection(displayedExcerpt(source, event.currentTarget.selectionStart, event.currentTarget.selectionEnd))} />
      {rawSelection ? <blockquote className="excerpt-confirm-preview">{rawSelection.excerpt}</blockquote> : null}
      <button type="button" disabled={!rawSelection} onClick={() => { setSelected(rawSelection); setRawOpen(false); }}>{props.copy.excerptUseSelection}</button>
    </FolderModal> : null}
  </div>;
}
