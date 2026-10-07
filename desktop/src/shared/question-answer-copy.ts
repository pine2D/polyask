import type { DesktopCopy } from './copy';
import type { QuestionAnswerRecord } from './question-history';

export function questionAnswerState(answer: Pick<QuestionAnswerRecord, 'submission' | 'capture'>, copy: DesktopCopy): string {
  if (answer.submission === 'failed') return copy.questionSubmissionFailed;
  if (answer.submission === 'cancelled') return copy.questionSubmissionCancelled;
  const capture = { waiting: copy.questionStateWaiting, partial: copy.questionStatePartial, complete: copy.questionStateComplete,
    unknown: copy.questionStateUnknown, unavailable: copy.questionStateUnavailable, interrupted: copy.questionStateInterrupted }[answer.capture];
  return answer.submission === 'unconfirmed' ? `${copy.questionSubmissionUnconfirmed} · ${capture}` : capture;
}
