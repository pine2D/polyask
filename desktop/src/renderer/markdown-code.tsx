import { useEffect, useMemo, useRef, useState } from 'react';
import { getCopy } from '../shared/copy';
import { highlightCode, supportsCodeHighlight } from './code-highlight';
import { CopyIcon } from './icons';
import { ReadingAction } from './reading-controls';

export function MarkdownCode({ source, language }: { readonly source: string; readonly language: string }): React.JSX.Element {
  const copy = getCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<{ source: string; language: string; kind: 'pending' | 'copied' | 'failed' } | null>(null);
  const alive = useRef(true), pending = useRef(false), revision = useRef(0), current = useRef({ source, language });
  current.current = { source, language };
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  const display = source.replace(/\n$/, '');
  const highlight = useMemo(() => highlightCode(display, language), [display, language]);
  const supported = supportsCodeHighlight(language);
  const currentNotice = notice?.source === source && notice.language === language ? notice : null;
  const copyCode = async () => {
    if (pending.current) return;
    pending.current = true;
    setCopying(true);
    const request = ++revision.current;
    setNotice({ source, language, kind: 'pending' });
    try {
      await navigator.clipboard.writeText(source);
      if (alive.current && request === revision.current && current.current.source === source && current.current.language === language) setNotice({ source, language, kind: 'copied' });
    } catch {
      if (alive.current && request === revision.current && current.current.source === source && current.current.language === language) setNotice({ source, language, kind: 'failed' });
    } finally { pending.current = false; if (alive.current) setCopying(false); }
  };
  const message = currentNotice?.kind === 'copied' ? copy.readingCodeCopied : currentNotice?.kind === 'failed' ? copy.readingCopyFailed : '';
  return <figure className="markdown-code">
    <figcaption><span className="markdown-code-language">{language || copy.readingCode}</span><div className="markdown-code-actions">
      <span role="status" aria-live="polite">{message}</span>
      <ReadingAction aria-disabled={copying} aria-busy={copying} aria-label={copy.readingCopyCode} title={copy.readingCopyCode} onClick={() => void copyCode()}><CopyIcon /></ReadingAction>
    </div></figcaption>
    <pre><code>{highlight ? highlight.map((part, index) => <span key={index} className={`code-${part.kind}`}>{part.text}</span>) : display}</code></pre>
    {(highlight === null) && <p className="markdown-code-notice">{!supported ? copy.readingHighlightUnsupported : copy.readingHighlightLimit}</p>}
  </figure>;
}
