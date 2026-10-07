import type { SiteDefinition } from '../../src/shared/contracts';
import type { QuestionAnswerRecord, QuestionDetail } from '../../src/shared/question-history';

export const historySites: readonly SiteDefinition[] = [
  { key: 'claude', label: 'Claude', host: 'claude.ai', url: 'https://claude.ai', authHosts: [], image: true, intl: true },
  { key: 'kimi', label: 'Kimi', host: 'www.kimi.com', url: 'https://www.kimi.com', authHosts: [], image: true, intl: false }
];
export const originalPrompt = '原问题：保留空白与 emoji 🧭\n\n' +
  Array.from({ length: 12 }, (_, i) => `${i + 1}. 请比较已保存的回答，说明理由，保留原始换行。 🧪`).join('\n\n') + '\n结尾标记';
const body = (name: string) => `# ${name}\n\n` + Array.from({ length: 30 }, (_, i) =>
  `${name} paragraph ${i + 1}. Saved text remains independent from the live page.`).join('\n\n') +
  '\n\n[First source](https://example.com/first)\n\n[Second source](https://example.com/second)\n\n' +
  '```mermaid\nflowchart LR\n  A[Saved] --> B[Compare]\n```';
const answer = (id: string, site: QuestionAnswerRecord['site'], attempt: number): QuestionAnswerRecord => ({
  schema: 4, id, questionId: 'history-native', site, attempt, createdAt: 1700000000000 + attempt,
  updatedAt: 1700000001000 + attempt, deviceId: 'fixture', submission: 'submitted', submissionCode: null,
  conversationUrl: site === 'claude' ? `https://claude.ai/chat/${id}` : null,
  capture: id === 'a1' ? 'partial' : 'complete', captureCode: null, answerMarkdown: body(id),
  capturedAt: 1700000001000 + attempt, sealedAt: 1700000001000 + attempt, truncated: id === 'a1'
});
export const savedDetail: QuestionDetail = {
  question: { schema: 4, id: 'history-native', text: originalPrompt, sites: ['claude', 'kimi'], requestedTier: null,
    inputImageCount: 0, createdAt: 1700000000000, updatedAt: 1700000001000, deviceId: 'fixture' },
  answers: [answer('a1', 'claude', 1), answer('a2', 'claude', 2), answer('b1', 'kimi', 1)], loadedAnswerId: 'a2'
};
