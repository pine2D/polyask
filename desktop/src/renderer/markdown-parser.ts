import MarkdownIt from 'markdown-it';
import { addMathTokens } from './markdown-math-tokens';

/** Only tokenize: React owns rendering, so raw HTML never enters the shell DOM. */
const parser = new MarkdownIt({ html: false, linkify: true, typographer: false, maxNesting: 32 });
parser.linkify.set({ fuzzyLink: true });
addMathTokens(parser);
export type MarkdownToken = MarkdownIt.Token;
export const parseMarkdown = (value: string): MarkdownToken[] => parser.parse(value, {});
export const parseMarkdownInline = (value: string): MarkdownToken[] => parser.parseInline(value, {})[0]?.children ?? [];

/** URL-only labels may be scheme-free, but a URL followed by a caption is a title. */
export function isMarkdownUrlLabel(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  let candidate = value;
  if (!/^https?:\/\//i.test(value)) {
    const matches = parser.linkify.match(value);
    if (matches?.length !== 1 || matches[0].index !== 0 || matches[0].lastIndex !== value.length) return false;
    candidate = matches[0].url;
  }
  try {
    const url = new URL(candidate);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
