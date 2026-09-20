import { createElement, type ReactNode } from 'react';
import { markdownInline } from './markdown-inline';

type LinkHandler = ((url: string) => void) | undefined;
const listItem = (line: string) => line.match(/^( *)([-+*]|\d+[.)])\s+(.*)$/);
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '', code = false;
  const text = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') { cell += '|'; i++; continue; }
    if (char === '`') code = !code;
    if (char === '|' && !code) { cells.push(cell.trim()); cell = ''; } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}
const tableDivider = (line: string) => line.includes('|') && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell));

function blocks(lines: string[], onOpenLink: LinkHandler, depth = 0): ReactNode[] {
  if (depth > 12) return [<p key="depth">{lines.join('\n')}</p>];
  const nodes: ReactNode[] = [];
  const inline = (value: string) => markdownInline(value, onOpenLink);
  let i = 0;
  const special = (at: number) => /^(?:\s*```|\s*~~~|#{1,6}\s|>\s?|[-*_]{3,}\s*$)/.test(lines[at])
    || !!listItem(lines[at]) || (at + 1 < lines.length && tableDivider(lines[at + 1]));
  while (i < lines.length) {
    const line = lines[i];
    const key = `block-${i}`;
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const content: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      nodes.push(<pre key={key} data-language={fence[2].trim() || undefined}><code>{content.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      nodes.push(createElement(`h${Math.min(6, heading[1].length + 2)}`, { key }, inline(heading[2]))); i++; continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { nodes.push(<hr key={key} />); i++; continue; }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^> ?/, ''));
      nodes.push(<blockquote key={key}>{blocks(quote, onOpenLink, depth + 1)}</blockquote>); continue;
    }
    if (i + 1 < lines.length && line.includes('|') && tableDivider(lines[i + 1])) {
      const headers = tableCells(line), alignment = tableCells(lines[i + 1]);
      const align = (column: number): 'left' | 'center' | 'right' => alignment[column]?.endsWith(':') ? alignment[column]?.startsWith(':') ? 'center' : 'right' : 'left';
      const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(tableCells(lines[i++]));
      nodes.push(<div className="markdown-table" key={key} tabIndex={0} role="region" aria-label={headers.join(' / ')}><table>
        <thead><tr>{headers.map((cell, column) => <th key={column} scope="col" style={{ textAlign: align(column) }}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, column) => <td key={column} style={{ textAlign: align(column) }}>{inline(row[column] ?? '')}</td>)}</tr>)}</tbody>
      </table></div>); continue;
    }
    const first = listItem(line);
    if (first) {
      const indent = first[1].length, ordered = /^\d/.test(first[2]);
      const items: ReactNode[] = [];
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break;
        const content = item[3];
        const offset = item[0].length - content.length;
        const nested: string[] = []; i++;
        while (i < lines.length && lines[i].trim() && (lines[i].match(/^ */)?.[0].length ?? 0) > indent) {
          const continuation = lines[i++];
          nested.push(continuation.slice(Math.min(offset, continuation.match(/^ */)![0].length)));
        }
        items.push(<li key={items.length}>{inline(content)}{nested.length ? blocks(nested, onOpenLink, depth + 1) : null}</li>);
      }
      nodes.push(ordered ? <ol key={key} start={parseInt(first[2], 10)}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !special(i)) paragraph.push(lines[i++]);
    nodes.push(<p key={key}>{inline(paragraph.join('\n'))}</p>);
  }
  return nodes;
}

export function MarkdownPreview({ value, onOpenLink }: { readonly value: string; readonly onOpenLink?: (url: string) => void }): React.JSX.Element {
  return <div className="markdown-preview">{blocks(String(value ?? '').replace(/\r\n?/g, '\n').split('\n'), onOpenLink)}</div>;
}
