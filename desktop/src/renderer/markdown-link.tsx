import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getCopy } from '../shared/copy';
import { CopyIcon, MoreIcon } from './icons';

function displayUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname === '/' ? '' : url.pathname;
  const points = [...path];
  return url.host + (points.length > 48 ? points.slice(0, 45).join('') + '…' : path);
}

export function MarkdownLink({ url, label, children, onOpenLink }: {
  readonly url: string; readonly label: string | null; readonly children: ReactNode; readonly onOpenLink: (url: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const group = useRef<HTMLSpanElement>(null);
  useEffect(() => { setExpanded(false); setCopied(false); setFailed(false); }, [url]);
  useEffect(() => {
    if (!expanded) return;
    const close = (event: PointerEvent) => { if (!group.current?.contains(event.target as Node)) setExpanded(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [expanded]);
  const copy = getCopy(typeof document === 'undefined' ? 'en' : document.documentElement.lang);
  let isUrl = false;
  const comparable = (value: string) => value.replace(/%28/gi, '(').replace(/%29/gi, ')');
  try { isUrl = !!label && comparable(new URL(label).href) === comparable(url); } catch { /* A meaningful label is kept. */ }
  const compact = label === '' || (isUrl && (label!.length > 80 || url.includes(':~:text=')));
  const link = <a href={url} title={url} onClick={event => { event.preventDefault(); onOpenLink(url); }}
    onAuxClick={event => { event.preventDefault(); if (event.button === 1) onOpenLink(url); }}>{compact ? displayUrl(url) : children}</a>;
  if (!compact) return link;
  return <span ref={group} className="markdown-link-group" onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); setExpanded(false); group.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }}>{link}<button type="button" className="markdown-link-details"
    aria-label={copy.readingLinkDetails} data-hint={copy.readingLinkDetails} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><MoreIcon /></button>
    {expanded && <span className="markdown-link-popover">
      <code>{url}</code><button type="button" aria-label={copy.readingCopyLink} onClick={() => {
        void navigator.clipboard.writeText(url).then(() => { setCopied(true); setFailed(false); }).catch(() => { setCopied(false); setFailed(true); });
      }}><CopyIcon />{copied ? copy.readingLinkCopied : copy.readingCopyLink}</button>
      <span role="status">{failed ? copy.readingCopyFailed : ''}</span>
      <span className="sr-only" aria-live="polite">{copied ? copy.readingLinkCopied : ''}</span>
    </span>}
  </span>;
}
