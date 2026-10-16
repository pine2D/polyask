import { useId, useLayoutEffect, useRef } from 'react';
import type { DesktopCopy } from '../shared/copy';

export function ArchiveQuestionPrompt({ text, copy, expanded, overflow, onExpandedChange, onOverflowChange }: {
  text: string; copy: DesktopCopy; expanded: boolean; onExpandedChange: (value: boolean) => void;
  overflow: boolean | null; onOverflowChange: (value: boolean) => void;
}): React.JSX.Element {
  const id = useId(), root = useRef<HTMLDivElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const control = useRef<HTMLButtonElement>(null);
  const anchor = useRef<{ reader: HTMLElement; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const node = heading.current, window = node?.ownerDocument.defaultView;
    if (!node || !window) return;
    const measure = () => {
      if (!node.clientHeight) return;
      const line = parseFloat(window.getComputedStyle(node).lineHeight);
      const next = node.scrollHeight > (expanded ? line * 3 : node.clientHeight) + 1;
      if (!next && !expanded && control.current === node.ownerDocument.activeElement) node.focus({ preventScroll: true });
      onOverflowChange(next);
    };
    measure();
    let width = node.getBoundingClientRect().width, frame = 0;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const next = node.getBoundingClientRect().width;
      if (next === width) return;
      width = next; if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }) : null;
    observer?.observe(node);
    return () => { observer?.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, [text, expanded]);
  useLayoutEffect(() => {
    const saved = anchor.current; anchor.current = null;
    if (saved && root.current) saved.reader.scrollTop += root.current.getBoundingClientRect().bottom - saved.bottom;
  }, [expanded]);
  return <div ref={root} className="archive-question-prompt">
    <h1 ref={heading} id={id} tabIndex={-1} className={expanded ? undefined : 'is-summary'}>{text}</h1>
    {overflow || expanded ? <button ref={control} type="button" aria-expanded={expanded} aria-controls={id} onClick={() => {
      const reader = root.current?.closest<HTMLElement>('.archive-detail-pane');
      const bottom = root.current?.getBoundingClientRect().bottom;
      if (reader && bottom !== undefined && bottom < reader.getBoundingClientRect().top)
        anchor.current = { reader, bottom };
      if (expanded && !overflow) heading.current?.focus({ preventScroll: true });
      onExpandedChange(!expanded);
    }}>{expanded ? copy.questionCollapse : copy.questionExpand}</button> : null}
  </div>;
}
