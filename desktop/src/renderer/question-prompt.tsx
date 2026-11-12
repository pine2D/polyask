import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';

export function QuestionPrompt({ text, copy }: {
  text: string; copy: DesktopCopy;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false), id = useId();
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ reader: HTMLElement; node: Element; top: number } | null>(null);
  const long = [...text].length > 140 || text.split(/\r?\n/).length > 2;
  const summary = [...text.replace(/\s+/g, ' ').trim()].slice(0, 140).join('');
  useLayoutEffect(() => {
    const saved = anchor.current; anchor.current = null;
    if (saved) saved.reader.scrollTop += saved.node.getBoundingClientRect().top - saved.top;
  }, [expanded]);
  return <div ref={root} className="question-prompt">
    <h2 id={id} className={long && !expanded ? 'is-summary' : undefined}>{long && !expanded ? `${summary}${[...text].length > 140 ? '…' : ''}` : text}</h2>
    {long && <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => {
      const reader = root.current?.closest<HTMLElement>('.question-reader');
      const node = reader?.querySelector('.question-answer');
      if (reader && node && root.current && root.current.getBoundingClientRect().bottom < reader.getBoundingClientRect().top)
        anchor.current = { reader, node, top: node.getBoundingClientRect().top };
      setExpanded(value => !value);
    }}>{expanded ? copy.questionCollapse : copy.questionExpand}</button>}
  </div>;
}
