import { createElement, useMemo, type ReactNode } from 'react';
import { inlineTokens } from './markdown-inline';
import { parseMarkdown, type MarkdownToken } from './markdown-parser';
import { MermaidPreview } from './mermaid-preview';
import { MarkdownCode } from './markdown-code';
import { MarkdownMath } from './markdown-math';
import { mathTokenValue } from './markdown-math-tokens';

type LinkHandler = ((url: string) => void) | undefined;
function renderTokens(tokens: readonly MarkdownToken[], onOpenLink: LinkHandler): ReactNode[] {
  let i = 0;
  function read(): ReactNode[] {
    const nodes: ReactNode[] = [];
    while (i < tokens.length) {
      const token = tokens[i++], key = i;
      if (token.nesting === -1) break;
      if (token.type === 'inline') nodes.push(...inlineTokens(token.children ?? [], onOpenLink));
      else if (token.type === 'math_block') nodes.push(<MarkdownMath key={key} {...mathTokenValue(token)} block />);
      else if (token.type === 'fence' || token.type === 'code_block') {
        const language = token.info.trim().split(/\s/)[0], source = token.content.replace(/\n$/, '');
        nodes.push(language.toLowerCase() === 'mermaid' ? <MermaidPreview key={key} source={source} /> : <MarkdownCode key={key} source={token.content} language={language} />);
      } else if (token.type === 'hr') nodes.push(<hr key={key} />);
      else if (token.type === 'html_block') nodes.push(<p key={key}>{token.content}</p>);
      else if (token.nesting === 1) {
        const start = i, children = read();
        if (token.hidden) { nodes.push(...children); continue; }
        const tag = /^h[1-6]$/.test(token.tag) ? `h${Math.min(6, Number(token.tag[1]) + 2)}` : token.tag;
        const props: Record<string, unknown> = { key };
        if (tag === 'ol') props.start = Number(token.attrGet('start') || 1);
        if (tag === 'th') props.scope = 'col';
        if (tag === 'th' || tag === 'td') {
          const align = String(token.attrGet('style') ?? '').match(/text-align:(left|right|center)/)?.[1];
          if (align) props.style = { textAlign: align };
        }
        if (!['p', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'h5', 'h6'].includes(tag)) { nodes.push(...children); continue; }
        const element = createElement(tag, props, children);
        nodes.push(tag === 'table' ? <div key={key} className="markdown-table" tabIndex={0} role="region"
          aria-label={tokens.slice(start, i).filter(t => t.type === 'inline').slice(0, 8).map(t => t.content).join(' / ')}>{element}</div> : element);
      }
    }
    return nodes;
  }
  return read();
}

export function MarkdownPreview({ value, onOpenLink }: { readonly value: string; readonly onOpenLink?: (url: string) => void }): React.JSX.Element {
  const tokens = useMemo(() => parseMarkdown(String(value ?? '')), [value]);
  return <div className="markdown-preview">{renderTokens(tokens, onOpenLink)}</div>;
}
