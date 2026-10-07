import type { SiteKey } from '../shared/contracts';
import type { SiteStatus } from '../shared/protocol';
import type { QuestionRunAnswerProgress, QuestionRunProgress } from '../shared/question-run-progress';
import type { WorkbenchGuidePreference } from './local-ui-preferences';
import { runProgressCounts, type RunProgressCounts } from './run-progress-model';

export interface WorkbenchGuideInput {
  readonly ready: boolean; readonly busy: boolean;
  readonly preference: WorkbenchGuidePreference | null; readonly dismissed: boolean;
  readonly participating: readonly SiteKey[];
  readonly runId: string | null; readonly activeSites: readonly SiteKey[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly progress: QuestionRunProgress | null;
}
export interface WorkbenchGuideTarget {
  readonly runId: string; readonly questionId: string;
  readonly readableIds: readonly string[]; readonly completeIds: readonly string[];
}
export interface WorkbenchGuideModel {
  readonly stage: 'hidden' | 'choose' | 'ask' | 'waiting' | 'read' | 'compare';
  readonly participants: readonly SiteKey[];
  readonly counts: RunProgressCounts;
  readonly target: WorkbenchGuideTarget | null;
}
export function latestGuideAnswers(input: WorkbenchGuideInput): readonly QuestionRunAnswerProgress[] {
  const progress = input.progress;
  if (!input.runId || progress?.runId !== input.runId || progress.state !== 'available' || !progress.questionId?.trim()) return [];
  const latest = new Map<SiteKey, QuestionRunAnswerProgress>();
  for (const answer of progress.answers) {
    if (!input.activeSites.includes(answer.site)) continue;
    if (!latest.has(answer.site) || latest.get(answer.site)!.attempt < answer.attempt) latest.set(answer.site, answer);
  }
  return [...new Set(input.activeSites)].flatMap(site => latest.get(site) ?? [])
    .filter(answer => answer.id.trim() && Number.isSafeInteger(answer.attempt) && answer.attempt > 0);
}
export function projectWorkbenchGuide(input: WorkbenchGuideInput): WorkbenchGuideModel {
  const counts = runProgressCounts(input.runId, input.activeSites, input.statuses, input.progress);
  const base = { participants: [...new Set(input.participating)], target: null, counts };
  if (!input.ready || input.busy || input.preference || input.dismissed) return { ...base, stage: 'hidden' };
  const stage = base.participants.length === 2 ? 'ask' : 'choose';
  if (!input.runId || new Set(input.activeSites).size < 2 || counts.submitted < 2) return { ...base, stage };
  const readable = latestGuideAnswers(input).filter(answer => answer.hasText && answer.capture !== 'unavailable');
  const readableIds = [...new Set(readable.map(answer => answer.id))];
  if (!readableIds.length) return { ...base, stage: 'waiting' };
  const completeIds = [...new Set(readable.filter(answer => answer.capture === 'complete' && !answer.truncated && answer.sealedAt !== null)
    .map(answer => answer.id))];
  return { ...base, stage: completeIds.length >= 2 ? 'compare' : 'read',
    target: { runId: input.runId, questionId: input.progress!.questionId!, readableIds, completeIds } };
}
