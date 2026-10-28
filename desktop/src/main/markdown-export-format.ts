import MarkdownIt from 'markdown-it';
import { safeExternalUrl } from './security';
type Token = MarkdownIt.Token;

const parser = new MarkdownIt({ html: true, linkify: false, typographer: false, maxNesting: 64 });
// 接受输入链接后由输出白名单决定是否保留，避免危险目标被原样作为 Markdown 文本吐回。
parser.validateLink = () => true;
export const markdownText = (text: string): string => text.replace(/&/g, '&amp;').replace(/[\\`*_[\]{}<>#!+.=~-]/g, c => `\\${c}`);
const htmlText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function url(value: unknown): string | null {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  const safe = value.startsWith('#') ? value : safeExternalUrl(value);
  return safe?.replace(/[<>]/g, c => encodeURIComponent(c)) ?? null;
}
function closing(tokens: Token[], index: number): number {
  let depth = 1;
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].type === tokens[index].type) depth++;
    if (tokens[i].type === tokens[index].type.replace(/_open$/, '_close') && --depth === 0) return i;
    // 不同容器的 close 不减少本类型深度。
    if (tokens[i].type !== tokens[index].type.replace(/_open$/, '_close')) continue;
  }
  return tokens.length;
}
function inline(tokens: Token[]): string {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'text') out += markdownText(t.content);
    else if (t.type === 'code_inline') {
      const fence = '`'.repeat(Math.max(0, ...[...t.content.matchAll(/`+/g)].map(m => m[0].length)) + 1);
      out += `${fence} ${t.content} ${fence}`;
    } else if (t.type === 'html_inline') out += htmlText(t.content);
    else if (t.type === 'softbreak') out += '\n';
    else if (t.type === 'hardbreak') out += '  \n';
    else if (t.type === 'link_open') {
      const end = closing(tokens, i), label = inline(tokens.slice(i + 1, end)), href = url(t.attrGet('href'));
      out += href ? `[${label}](<${href}>)` : label; i = end;
    } else if (t.type === 'image') {
      const label = inline(t.children ?? []) || markdownText(t.content), href = url(t.attrGet('src'));
      out += href ? `[${label || markdownText(href)}](<${href}>)` : label;
    } else if (t.type.startsWith('strong_')) out += '**';
    else if (t.type.startsWith('em_')) out += '*';
    else if (t.type.startsWith('s_')) out += '~~';
    else out += markdownText(t.content);
  }
  return out;
}
function block(tokens: Token[], offset: number): string {
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'paragraph_open' || t.type === 'heading_open') {
      const end = closing(tokens, i), body = tokens.slice(i + 1, end).map(v => inline(v.children ?? [])).join('');
      chunks.push(t.type === 'heading_open' ? `${'#'.repeat(Math.min(6, Number(t.tag.slice(1)) + offset))} ${body}` : body); i = end;
    } else if (t.type === 'fence' || t.type === 'code_block') {
      const fence = '`'.repeat(Math.max(2, ...[...t.content.matchAll(/`+/g)].map(m => m[0].length)) + 1);
      const language = t.type === 'fence' ? t.info.trim().split(/\s/)[0].replace(/[^\w+-]/g, '') : '';
      chunks.push(`${fence}${language}\n${t.content}${t.content.endsWith('\n') ? '' : '\n'}${fence}`);
    } else if (t.type === 'blockquote_open') {
      const end = closing(tokens, i); chunks.push(block(tokens.slice(i + 1, end), offset).split('\n').map(line => `> ${line}`).join('\n')); i = end;
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const end = closing(tokens, i), items: string[] = []; let number = Number(t.attrGet('start') ?? 1);
      for (let j = i + 1; j < end; j++) if (tokens[j].type === 'list_item_open') {
        const last = closing(tokens, j), prefix = t.type === 'bullet_list_open' ? '- ' : `${number++}. `;
        const lines = block(tokens.slice(j + 1, last), offset).split('\n');
        items.push(prefix + lines.map((line, n) => n ? ' '.repeat(prefix.length) + line : line).join('\n')); j = last;
      }
      chunks.push(items.join('\n')); i = end;
    } else if (t.type === 'table_open') {
      const end = closing(tokens, i), rows: string[] = []; let cells: string[] = [];
      for (let j = i + 1; j < end; j++) {
        if (tokens[j].type === 'tr_open') cells = [];
        if (tokens[j].type === 'inline') cells.push(inline(tokens[j].children ?? []).replace(/\|/g, '\\|').replace(/\n/g, ' '));
        if (tokens[j].type === 'tr_close') { rows.push(`| ${cells.join(' | ')} |`); if (rows.length === 1) rows.push(`| ${cells.map(() => '---').join(' | ')} |`); }
      }
      chunks.push(rows.join('\n')); i = end;
    } else if (t.type === 'html_block') chunks.push(htmlText(t.content).trimEnd());
    else if (t.type === 'hr') chunks.push('---');
    else if (t.type === 'inline') chunks.push(inline(t.children ?? []));
    else if (t.content) chunks.push(markdownText(t.content));
  }
  return chunks.join('\n\n');
}
export function safeExportMarkdown(source: string, headingOffset = 3): string {
  // 数学源文本不交给普通 Markdown 的强调/转义规则改写；可执行 HTML/链接仍走普通解析。
  let marker = 'POLYASKMATH'; while (source.includes(marker)) marker += 'X';
  const math: string[] = [];
  const protectedSource = source.replace(/\$\$[\s\S]*?\$\$|\$(?!\$)[^\n$]+\$|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g, value => {
    if (/<[a-z!/]|\]\(/i.test(value)) return value;
    const key = `${marker}${math.length}END`; math.push(value); return key;
  });
  const result = block(parser.parse(protectedSource, {}), headingOffset);
  return result.replace(new RegExp(`${marker}(\\d+)END`, 'g'), (_all, n: string) => math[Number(n)]);
}
