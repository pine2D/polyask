import MarkdownIt from 'markdown-it';
import { safeExternalUrl } from './security';

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

export const renderReportMarkdown = (value: string): string => markdown.render(value);
