import { DesktopDatabase } from '../../src/main/database';
import { questionAnswerId } from '../../src/main/question-repository';
import { createArchiveRecord, updateArchiveRecord } from '../../src/shared/archive';
import type { QuestionRecord, QuestionAnswerRecord } from '../../src/shared/question-history';
export { registerMarkdownExportIpc } from '../../src/main/markdown-export-ipc';
export function prepareMarkdownNativeData() {
  const db = DesktopDatabase.open(':memory:');
  const questions: QuestionRecord[] = Array.from({ length: 3 }, (_, i) => ({ schema: 4, id: `q-${i}`, createdAt: 1000 + i,
    updatedAt: 1000 + i, deviceId: 'synthetic', text: i === 0 ? '比较三份研究建议，并保留原始回答版本 · Research question '.repeat(3) : `研究问题 Research question ${i + 1}`,
    sites: ['claude', 'chatgpt'], requestedTier: 'think', inputImageCount: 0 }));
  const answers: QuestionAnswerRecord[] = questions.flatMap(q => (['claude', 'chatgpt'] as const).flatMap(site => [1, 2].map(attempt => ({
    schema: 4 as const, id: questionAnswerId(q.id, site, attempt), questionId: q.id, site, attempt,
    createdAt: q.createdAt, updatedAt: q.createdAt, deviceId: 'synthetic', submission: 'submitted' as const, submissionCode: null,
    conversationUrl: null, answerMarkdown: `# 原始回答 Answer\n\n${site.toUpperCase()}_${q.id}_${attempt}\n\n| 来源 | 结论 |\n| --- | --- |\n| ${site} | 保留原文 |\n\n\`\`\`ts\nconst x = '<safe>';\n\`\`\`\n\n$$x^2$$`,
    capture: 'complete' as const, captureCode: null, capturedAt: q.createdAt, sealedAt: q.createdAt, truncated: false
  }))));
  questions.forEach(q => db.questions.put(q)); answers.forEach(a => db.questions.putAnswer(a));
  const archives = [0, 1].map(i => createArchiveRecord({ text: '采集记录 Captured answers', task: `已采集的结果 ${i + 1} / Saved research`,
    results: [{ host: 'claude.ai', label: 'Claude', text: `ARCHIVE_CLAUDE_${i}` }, { host: 'chatgpt.com', label: 'ChatGPT', text: `ARCHIVE_CHATGPT_${i}` }]
  }, { id: `archive-${i}`, now: 1000 + i, deviceId: 'synthetic' })).map(r => updateArchiveRecord(r, { synthesis: { host: 'claude.ai', text: 'SYNTHESIS uses [S1] and [S2].', state: null, instruction: '', createdAt: 1000 } }, { now: 2000, deviceId: 'synthetic' }));
  const decision = { schema: 2 as const, id: 'decision-a', archiveId: archives[0].id, sourceTitle: archives[0].task, title: '研究决策 / Decision',
    conclusion: 'DECISION_CONCLUSION', rationale: '', uncertainties: '', nextStep: '', status: 'draft' as const, evidence: [], createdAt: 1000, updatedAt: 1000, deviceId: 'synthetic' };
  return { db, data: { questions, answers, archives, decision }, repositories: { questions: db.questions,
    archives: { get: (id: string) => archives.find(a => a.id === id) ?? null }, decisions: { get: (id: string) => id === decision.id ? decision : null } } };
}
