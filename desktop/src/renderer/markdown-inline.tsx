import { createElement, type ReactNode } from 'react';
import { parseMarkdownInline, type MarkdownToken } from './markdown-parser';
import { MarkdownLink } from './markdown-link';

export function safeMarkdownUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function inlineTokens(tokens: readonly MarkdownToken[], onOpenLink?: (url: string) => void): ReactNode[] {
  let i = 0;
  function read(): ReactNode[] {
    const nodes: ReactNode[] = [];
    while (i < tokens.length) {
      const token = tokens[i++], key = i;
      if (token.nesting === -1) break;
      if (token.type === 'text' || token.type === 'html_inline') nodes.push(token.content);
      else if (token.type === 'softbreak') nodes.push('\n');
      else if (token.type === 'hardbreak') nodes.push(<br key={key} />);
      else if (token.type === 'code_inline') nodes.push(<code key={key}>{token.content}</code>);
      else if (token.type === 'image') nodes.push(`[${token.content}]`);
      else if (token.nesting === 1) {
        const start = i, children = read();
        if (token.type === 'link_open') {
          const href = safeMarkdownUrl(String(token.attrGet('href') ?? ''));
          const labelTokens = tokens.slice(start, i - 1);
          const label = labelTokens.every(t => t.type === 'text') ? labelTokens.map(t => t.content).join('') : null;
          nodes.push(href && onOpenLink ? <MarkdownLink key={key} url={href} label={label} onOpenLink={onOpenLink}>{children}</MarkdownLink> : <span key={key}>{children}</span>);
        } else if (['strong', 'em', 's'].includes(token.tag)) nodes.push(createElement(token.tag === 's' ? 'del' : token.tag, { key }, children));
        else nodes.push(...children);
      }
    }
    return nodes;
  }
  return read();
}

export function markdownInline(value: string, onOpenLink?: (url: string) => void): ReactNode[] {
  return inlineTokens(parseMarkdownInline(value), onOpenLink);
}
