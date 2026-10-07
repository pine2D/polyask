import type { SiteKey } from '../shared/contracts';
import type { SiteStatus } from '../shared/protocol';
import type { QuestionRunProgress } from '../shared/question-run-progress';

export interface RunProgressCounts {
  readonly submitted: number; readonly generating: number; readonly ended: number;
  readonly complete: number; readonly partial: number; readonly failed: number;
  readonly unconfirmed: number; readonly cancelled: number; readonly hasReadableCopy: boolean;
}
export function runProgressCounts(runId: string | null, scope: readonly SiteKey[],
  statuses: Readonly<Record<string, SiteStatus>>, progress: QuestionRunProgress | null): RunProgressCounts {
  const counts = { submitted: 0, generating: 0, ended: 0, complete: 0, partial: 0,
    failed: 0, unconfirmed: 0, cancelled: 0, hasReadableCopy: false };
  if (!runId) return counts;
  const answers = new Map<SiteKey, QuestionRunProgress['answers'][number]>();
  if (progress?.runId === runId && progress.state === 'available') {
    for (const answer of progress.answers) {
      if (!answers.has(answer.site) || answers.get(answer.site)!.attempt < answer.attempt) answers.set(answer.site, answer);
    }
  }
  for (const site of new Set(scope)) {
    const status = statuses[site], answer = answers.get(site);
    // 本次重试已建立新 attempt 时，旧页面的提交徽记不能盖过新 pending。
    const submission = answer?.submission ?? (status?.submission?.runId === runId
      ? status.submission.state === 'sent' ? 'submitted' : status.submission.state : undefined);
    if (submission === 'submitted') counts.submitted++;
    if (submission === 'failed') counts.failed++;
    if (submission === 'unconfirmed') counts.unconfirmed++;
    if (submission === 'cancelled') counts.cancelled++;
    if (submission === 'submitted' && status?.generation?.runId === runId) {
      if (status.generation.state === 'generating') counts.generating++;
      if (status.generation.state === 'complete') counts.ended++;
    }
    if (answer?.hasText) {
      counts.hasReadableCopy = true;
      if (answer.capture === 'complete' && !answer.truncated && answer.sealedAt !== null) counts.complete++;
      else counts.partial++;
    }
  }
  return counts;
}
