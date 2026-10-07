import type { SiteKey } from './contracts';
import type { CaptureState, SubmissionState } from './question-history';

/** 运行期投影；不进入问题记录、同步线格式或备份。 */
export interface QuestionRunAnswerProgress {
  readonly id: string;
  readonly site: SiteKey;
  readonly attempt: number;
  readonly submission: SubmissionState;
  readonly capture: CaptureState;
  readonly hasText: boolean;
  readonly truncated: boolean;
  readonly sealedAt: number | null;
}
export interface QuestionRunProgress {
  readonly runId: string;
  readonly questionId: string | null;
  readonly revision: number;
  readonly state: 'available' | 'unavailable';
  readonly answers: readonly QuestionRunAnswerProgress[];
}
