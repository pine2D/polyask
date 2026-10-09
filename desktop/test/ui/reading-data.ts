import type { QuestionDetail, QuestionAnswerRecord } from '../../src/shared/question-history';
export const diagramSource = 'flowchart LR\n  A[开始] --> B{检查}\n  B -->|通过| C[保存]\n  B -->|失败| D[重试]\n  D --> B';
export const longSourceUrl = 'https://poe2db.tw/cn/Rune#:~:text=' + '%E6%A0%B9'.repeat(100);
export const readingUrlCases = [
  { label: `**${longSourceUrl}**`, target: longSourceUrl, visible: 'poe2db.tw/cn/Rune' },
  { label: '`' + longSourceUrl + '`', target: 'https://poe2db.tw/cn/Rune', visible: 'poe2db.tw/cn/Rune' },
  { label: longSourceUrl, target: 'https://actual.example/notice.html', visible: 'actual.example/notice.html' },
  { label: longSourceUrl.slice(0, 70) + '\n' + longSourceUrl.slice(70), target: longSourceUrl, visible: 'poe2db.tw/cn/Rune' },
  { label: '\u00a0' + longSourceUrl.toLowerCase() + '\u00a0', target: longSourceUrl, visible: 'poe2db.tw/cn/Rune' },
  { label: 'poe2db.tw/cn/Rune?query=' + 'x'.repeat(100), target: longSourceUrl, visible: 'poe2db.tw/cn/Rune' }
];
export const readingLinksMarkdown = readingUrlCases.map(c => `[${c.label}](${c.target})`).join('\n\n') + `\n\n[**官方资料**](${longSourceUrl})`;
const answer = (id: string, site: QuestionAnswerRecord['site'], attempt: number, url: string | null): QuestionAnswerRecord => ({
  schema: 4, id, questionId: 'q-reading', createdAt: 1000, updatedAt: 2000, deviceId: 'fixture', site, attempt,
  submission: 'submitted', submissionCode: null, capture: 'complete', captureCode: null, conversationUrl: url,
  answerMarkdown: `[${longSourceUrl}](${longSourceUrl}) [配方资料](${longSourceUrl})\n\n` + readingLinksMarkdown + '\n\n| 功能 | 推荐 |\n| --- | --- |\n| **记录** | a\\_i 与 b\\_j |\n\n' + '```mermaid\n' + diagramSource + '\n```',
  capturedAt: 2000, sealedAt: 2000, truncated: false
});
export const readingDetail: QuestionDetail = {
  question: { schema: 4, id: 'q-reading', text: '合成验收：阅读链接与图表', createdAt: 1000, updatedAt: 2000, deviceId: 'fixture', sites: ['kimi', 'chatglm'], requestedTier: null, inputImageCount: 0 },
  answers: [answer('a1', 'kimi', 1, 'https://www.kimi.com/chat/first'), answer('a2', 'kimi', 2, 'https://www.kimi.com/chat/second'), answer('a3', 'chatglm', 1, null)]
};
