import type { ReactNode } from 'react';

export function safeMarkdownUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

/** React escapes raw HTML; only explicit external-link callbacks can navigate. */
export function markdownInline(value: string, onOpenLink?: (url: string) => void, depth = 0): ReactNode[] {
  if (depth > 8) return [value];
  const tokens = /(`+)([^`]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|\[([^\]]+)\]\(([^\s]*(?:\([^\s]*\)[^\s]*)?)\)/g;
  const nodes: ReactNode[] = [];
  let end = 0;
  for (const match of value.matchAll(tokens)) {
    if (match.index! > end) nodes.push(value.slice(end, match.index));
    const key = match.index;
    const inner = (text: string) => markdownInline(text, onOpenLink, depth + 1);
    if (match[1]) nodes.push(<code key={key}>{match[2]}</code>);
    else if (match[3] || match[4]) nodes.push(<strong key={key}>{inner(match[3] || match[4])}</strong>);
    else if (match[5]) nodes.push(<del key={key}>{inner(match[5])}</del>);
    else if (match[6]) nodes.push(<em key={key}>{inner(match[6])}</em>);
    else {
      const url = safeMarkdownUrl(match[8]);
      nodes.push(url && onOpenLink ? <a key={key} href={url} title={url} onClick={event => { event.preventDefault(); onOpenLink(url); }}
        onAuxClick={event => { event.preventDefault(); if (event.button === 1) onOpenLink(url); }}>{inner(match[7])}</a> : match[0]);
    }
    end = match.index! + match[0].length;
  }
  if (end < value.length) nodes.push(value.slice(end));
  return nodes;
}
