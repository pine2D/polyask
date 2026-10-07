import type { SiteKey } from '../shared/contracts';
import type { QuestionDetail } from '../shared/question-history';

export class QuestionReaderSession {
  private readonly active = new Map<string, { site: SiteKey; answerId?: string }>();
  private readonly selections = new Map<string, string>();
  private readonly positions = new Map<string, number>();
  site(detail: QuestionDetail): SiteKey {
    const site = this.active.get(detail.question.id)?.site;
    return site && detail.question.sites.includes(site) ? site : detail.question.sites[0];
  }
  answer(detail: QuestionDetail, site: SiteKey): string | undefined {
    const answers = detail.answers.filter(a => a.site === site);
    const selected = this.selections.get(`${detail.question.id}:${site}`);
    return answers.find(a => a.id === selected)?.id ?? answers.at(-1)?.id;
  }
  preferredAnswer(questionId: string): string | undefined { return this.active.get(questionId)?.answerId; }
  select(detail: QuestionDetail, site: SiteKey, answerId?: string): void {
    this.active.set(detail.question.id, { site, answerId });
    if (answerId) this.selections.set(`${detail.question.id}:${site}`, answerId);
  }
  remember(answerId: string, top: number): void { this.positions.set(answerId, Math.max(0, top)); }
  position(answerId?: string): number { return answerId ? this.positions.get(answerId) ?? 0 : 0; }
}
