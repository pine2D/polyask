import MarkdownIt from 'markdown-it';
import { safeExternalUrl } from './security';
import { addMathTokens, mathTokenValue, type MathTokenValue } from '../shared/markdown-math-tokens';
import { reportMathKey, REPORT_MATH_LIMIT } from './report-math';
import { validReportPng, REPORT_DIAGRAM_LIMIT } from './report-visuals';

export interface ReportMarkdownContext {
  readonly [key: string | symbol]: unknown;
  readonly guard?: () => void;
  readonly diagrams?: Map<string, string>;
  readonly collect?: Set<string>;
  readonly collectMath?: Map<string, MathTokenValue>;
  readonly math?: Map<string, string>;
  readonly mathIds?: Map<string, number>;
}

export const escapeReportText = (value: string): string => value.replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false, maxNesting: 32 });
// 图片保留可读说明；任何来源都不能变成请求，包括 data: 与 file:。
markdown.renderer.rules.image = (tokens, index) => escapeReportText(`[${tokens[index].content}]`);
markdown.renderer.rules.link_open = (tokens, index) => {
  const url = safeExternalUrl(tokens[index].attrGet('href'));
  return url ? `<a href="${escapeReportText(url)}" rel="noreferrer noopener">` : '<span>';
};
markdown.renderer.rules.link_close = (tokens, index) => {
  let depth = 1;
  for (let i = index - 1; i >= 0; i--) {
    if (tokens[i].type === 'link_close') depth++;
    if (tokens[i].type === 'link_open' && --depth === 0) return safeExternalUrl(tokens[i].attrGet('href')) ? '</a>' : '</span>';
  }
  return '</span>';
};
// 报告标题与来源标题占用 h1/h2，正文的标题级别固定下沉。
for (const type of ['heading_open', 'heading_close']) markdown.renderer.rules[type] = (tokens, index) => {
  const token = tokens[index], level = Math.min(6, Number(token.tag.slice(1)) + 2);
  return token.nesting === 1 ? `<h${level}>` : `</h${level}>\n`;
};

addMathTokens(markdown);
for (const type of ['math_inline', 'math_block']) markdown.renderer.rules[type] = (tokens, index, _options, env: ReportMarkdownContext = {}) => {
  const value = mathTokenValue(tokens[index]), key = reportMathKey(value);
  if (env.collectMath && env.collectMath.size < REPORT_MATH_LIMIT) env.collectMath.set(key, value);
  const fallback = `<code>${escapeReportText(value.literal)}</code>`;
  const markup = env.math?.get(key);
  return markup ? markup.replace('<math ', `<math data-report-math="${env.mathIds?.get(key)}" `)
    : (type === 'math_block' ? `<pre>${fallback}</pre>` : fallback);
};
const fence = markdown.renderer.rules.fence!;
markdown.renderer.rules.fence = (tokens, index, options, env: ReportMarkdownContext = {}, self) => {
  const token = tokens[index];
  if (token.info.trim().toLowerCase() === 'mermaid') {
    if (env.collect && env.collect.size < REPORT_DIAGRAM_LIMIT) env.collect.add(token.content);
    const image = env.diagrams?.get(token.content);
    if (image && validReportPng(image)) return `<figure class="report-diagram"><img src="${image}" alt="${escapeReportText(token.content)}"></figure>`;
  }
  return fence(tokens, index, options, env, self);
};
export const renderReportMarkdown = (value: string, context: ReportMarkdownContext = {}): string => {
  context.guard?.();
  return markdown.render(value, context);
};
