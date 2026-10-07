import type { QuestionDetail } from '../shared/question-history';

export interface QuestionReadingRequest {
  readonly request: number; readonly questionId: string; readonly answerId?: string;
  readonly source?: 'guide'; readonly mode?: 'read' | 'compare'; readonly answerIds?: readonly string[];
}
/** Guide choices use the latest sealed copies. The archive service rechecks their versions on explicit save. */
export function guideComparisonChoices(detail: QuestionDetail, request: QuestionReadingRequest): readonly string[] {
  if (request.source !== 'guide' || request.mode !== 'compare' || request.questionId !== detail.question.id || request.answerIds?.length !== 2) return [];
  const answers = request.answerIds.map(id => detail.answers.find(answer => answer.id === id));
  if (answers.some(answer => !answer || answer.questionId !== detail.question.id || answer.submission !== 'submitted' ||
    answer.capture !== 'complete' || answer.truncated || answer.sealedAt === null || answer.capturedAt === null ||
    detail.answers.some(other => other.site === answer.site && other.attempt > answer.attempt))) return [];
  if (new Set(answers.map(answer => answer!.site)).size !== 2) return [];
  return answers.map(answer => answer!.id);
}
