import type { QuestionRunProgress } from '../shared/question-run-progress';
import type { QuestionRepository } from './question-repository';

export class QuestionRunProgressTracker {
  private current: { runId: string; id: string | null; lifecycle: number; failed: boolean } | null = null;
  private revision = 0;
  private signature = '';
  private listener: ((progress: QuestionRunProgress) => void) | null = null;
  constructor(private readonly repository: QuestionRepository) {}
  last(): QuestionRunProgress | null { return this.current ? this.read(this.current.runId) : null; }
  listen(listener: ((progress: QuestionRunProgress) => void) | null): void { this.listener = listener; }
  begin(runId: string, id: string | null): void {
    this.current = { runId, id, lifecycle: this.repository.lifecycle, failed: id === null };
    this.publish();
  }
  failed(): void { if (this.current) { this.current.failed = true; this.publish(); } }
  read(runId: string): QuestionRunProgress | null {
    const current = this.current;
    if (!current || current.runId !== runId) return null;
    const unavailable = (): QuestionRunProgress => ({ runId, questionId: null, revision: this.revision,
      state: 'unavailable', answers: [] });
    if (!current.id || current.failed || current.lifecycle !== this.repository.lifecycle) return unavailable();
    try {
      const answers = this.repository.runAnswerProgress(current.id);
      return answers === null ? unavailable() : { runId, questionId: current.id,
        revision: this.revision, state: 'available', answers };
    } catch { current.failed = true; return unavailable(); }
  }
  publish(): void {
    if (!this.current) return;
    const value = this.read(this.current.runId)!;
    const signature = JSON.stringify({ ...value, revision: 0 });
    if (signature === this.signature) return;
    this.signature = signature;
    this.revision++;
    // 通知失败不能阻断提交、生成监视或落库。
    try { this.listener?.({ ...value, revision: this.revision }); } catch { /* Display only. */ }
  }
}
