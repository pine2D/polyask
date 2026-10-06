import MarkdownIt from 'markdown-it';

/** Only tokenize: React owns rendering, so raw HTML never enters the shell DOM. */
const parser = new MarkdownIt({ html: false, linkify: true, typographer: false, maxNesting: 32 });
export type MarkdownToken = MarkdownIt.Token;
export const parseMarkdown = (value: string): MarkdownToken[] => parser.parse(value, {});
export const parseMarkdownInline = (value: string): MarkdownToken[] => parser.parseInline(value, {})[0]?.children ?? [];
