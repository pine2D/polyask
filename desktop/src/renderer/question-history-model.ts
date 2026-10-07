import type { DesktopSurface } from "../shared/protocol";
import { formatCopy, type DesktopCopy } from '../shared/copy';
export { questionAnswerState as answerState } from '../shared/question-answer-copy';
export interface QuestionDetailView {
  readonly questionId: string;
  readonly answerId?: string;
  readonly state: 'loading' | 'ready' | 'missing' | 'failed';
}
export function questionDay(time: number, now: number, copy: DesktopCopy): string {
  const day = (value: number) => new Date(value).toLocaleDateString();
  if (day(time) === day(now)) return copy.questionToday;
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return day(time) === day(yesterday.getTime()) ? copy.questionYesterday : copy.questionEarlier;
}
export function questionHistorySurface(open: boolean, full: boolean): DesktopSurface | null {
  return open ? full ? "question-history" : "sites" : null;
}

export function questionReaskWarning(draft: string, draftImages: number, text: string, images: number, copy: DesktopCopy): string {
  const messages: string[] = [];
  if (draft.trim() && draft !== text) messages.push(copy.questionDraftWarning);
  if (draftImages > 0) messages.push(copy.questionClearImages);
  if (images > 0) messages.push(formatCopy(copy.questionReattach, { count: images }));
  return messages.join('\n');
}
