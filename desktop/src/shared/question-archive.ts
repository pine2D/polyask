import type { ArchiveInput } from './archive';
import type { SiteDefinition } from './contracts';
import type { QuestionAnswerRecord, QuestionRecord } from './question-history';
import { formatCopy, getCopy } from './copy';
import { questionAnswerState } from './question-answer-copy';

export type QuestionArchiveLocale = 'en' | 'zh-CN' | 'zh-TW';
export interface QuestionArchiveSelection { readonly answerId: string; readonly updatedAt: number }
export interface QuestionArchiveRequest {
  readonly questionId: string;
  readonly answers: readonly QuestionArchiveSelection[];
  readonly locale: QuestionArchiveLocale;
}

export function projectQuestionArchiveInput(question: QuestionRecord, answers: readonly QuestionAnswerRecord[],
  sites: readonly SiteDefinition[], locale: QuestionArchiveLocale): ArchiveInput {
  const copy = getCopy(locale);
  const results = question.sites.flatMap(key => {
    const answer = answers.find(a => a.site === key);
    if (!answer) return [];
    const site = sites.find(s => s.key === key);
    if (!site) throw new Error('invalid_question');
    const label = [site.label, formatCopy(copy.questionAttempt, { number: answer.attempt }),
      formatCopy(copy.questionCaptured, { time: new Date(answer.capturedAt ?? answer.createdAt).toLocaleString(locale) }),
      questionAnswerState(answer, copy)].join(' · ');
    return [{ host: site.host, label, text: answer.answerMarkdown, ...(answer.truncated ? { code: 'answer_truncated' } : {}) }];
  });
  return { text: question.text, task: question.text, source: null, results };
}
