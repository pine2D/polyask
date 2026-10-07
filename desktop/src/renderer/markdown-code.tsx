import { useEffect, useRef, useState } from 'react';
import { getCopy } from '../shared/copy';
import { CODE_HIGHLIGHT_LIMIT, highlightCode, supportsCodeHighlight, type CodePart } from './code-highlight';

export function MarkdownCode({ source, language }: { readonly source: string; readonly language: string }): React.JSX.Element {
  const copy = getCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
  const [highlight, setHighlight] = useState<readonly CodePart[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<{ source: string; language: string; kind: 'pending' | 'copied' | 'failed' } | null>(null);
  const alive = useRef(true), pending = useRef(false), revision = useRef(0), current = useRef({ source, language });
  current.current = { source, language };
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => { setHighlight(null); setLimited(false); }, [source, language]);
  const display = source.replace(/\n$/, '');
  const supported = supportsCodeHighlight(language), overLimit = source.length > CODE_HIGHLIGHT_LIMIT;
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
      <button type="button" disabled={copying} onClick={() => void copyCode()}>{copy.readingCopyCode}</button>
      <button type="button" disabled={!supported || overLimit || limited} aria-pressed={highlight !== null} onClick={() => {
        if (highlight) { setHighlight(null); return; }
        const parts = highlightCode(display, language); setHighlight(parts); setLimited(parts === null);
      }}>{highlight ? copy.readingPlainCode : copy.readingHighlight}</button>
    </div></figcaption>
    <pre><code>{highlight ? highlight.map((part, index) => <span key={index} className={`code-${part.kind}`}>{part.text}</span>) : display}</code></pre>
    {(!supported || overLimit || limited) && <p className="markdown-code-notice">{!supported ? copy.readingHighlightUnsupported : copy.readingHighlightLimit}</p>}
    <span role="status" aria-live="polite">{message}</span>
  </figure>;
}
