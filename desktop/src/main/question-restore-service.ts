import { SITES } from "./sites";
import { randomUUID } from "node:crypto";
import { SITE_KEYS, type SiteKey } from "../shared/contracts";
import type { QuestionRestorePreview, QuestionRestoreResult } from "../shared/question-restore";
import { safeQuestionUrl } from "./question-navigation";
import type { QuestionRepository } from "./question-repository";

interface RestoreOptions {
  selection: () => readonly SiteKey[];
  select: (sites: readonly SiteKey[]) => void;
  context: (site: SiteKey) => { id: number; url: string } | null;
  navigate: (site: SiteKey, url: string) => Promise<void>;
  stop: (site: SiteKey, contentsId?: number) => void;
  beforeNavigate: (sites: readonly SiteKey[]) => Promise<void>;
}
interface Plan { questionId: string; answerId?: string; signature: string; needsConfirmation: boolean }
export class QuestionRestoreService {
  private readonly plans = new Map<string, Plan>();
  private readonly inFlight = new Map<SiteKey, number | undefined>();
  private epoch = 0;
  constructor(private readonly repository: QuestionRepository, private readonly options: RestoreOptions) {}
  private describe(questionId: string, answerId?: string) {
    const record = this.repository.get(questionId);
    if (!record || "deletedAt" in record) throw new Error("history_not_found");
    const answers = this.repository.answers(questionId);
    const chosen = answerId ? answers.find(a => a.id === answerId) : null;
    if (answerId && !chosen) throw new Error("history_not_found");
    const sites = chosen ? [chosen.site] : record.sites;
    const requested = chosen ? [...this.options.selection(), chosen.site] : sites;
    const selection = SITE_KEYS.filter(site => requested.includes(site));
    const targets = sites.map(site => {
      const answer = chosen ?? answers.filter(a => a.site === site).at(-1);
      return { site, url: answer?.conversationUrl ? safeQuestionUrl(site, answer.conversationUrl) : null,
        answerId: answer?.id };
    });
    const contexts = [...new Set([...this.options.selection(), ...sites])].map(site => ({ site, context: this.options.context(site) }));
    const affected = contexts.filter(({ site, context }) => context &&
      (!selection.includes(site) || targets.some(t => t.site === site && t.url && t.url !== context.url))).map(item => item.site);
    return { record, sites: selection, targets, affected, contexts, signature: JSON.stringify([this.repository.lifecycle, record.updatedAt, targets, contexts, this.options.selection()]) };
  }
  preview(questionId: string, answerId?: string): QuestionRestorePreview {
    const data = this.describe(questionId, answerId), token = randomUUID();
    this.plans.clear();
    this.plans.set(token, { questionId, answerId, signature: data.signature, needsConfirmation: data.affected.length > 0 });
    return { token, questionId, sites: data.sites, affected: data.affected, needsConfirmation: data.affected.length > 0 };
  }
  async restore(token: string, confirmed: boolean): Promise<QuestionRestoreResult[]> {
    const plan = this.plans.get(token);
    if (!plan) throw new Error("history_restore_stale");
    if (plan.needsConfirmation && !confirmed) throw new Error("history_confirmation_required");
    const data = this.describe(plan.questionId, plan.answerId);
    if (data.signature !== plan.signature) throw new Error("history_restore_stale");
    this.plans.delete(token);
    const lifecycle = this.repository.lifecycle;
    const epoch = ++this.epoch, deadline = Date.now() + 30_000;
    const current = () => {
      const q = this.repository.get(plan.questionId);
      return epoch === this.epoch && lifecycle === this.repository.lifecycle && q && !("deletedAt" in q);
    };
    await this.options.beforeNavigate(data.affected);
    if (!current()) return data.targets.map(t => ({ site: t.site, state: "cancelled" }));
    if (this.describe(plan.questionId, plan.answerId).signature !== data.signature) throw new Error("history_restore_stale");
    this.options.select(data.sites);
    const selected = JSON.stringify(data.sites);
    const expected = new Map(data.targets.map(t => [t.site, this.options.context(t.site)]));
    const queue = [...data.targets], results = new Map<SiteKey, QuestionRestoreResult>();
    const worker = async () => {
      while (queue.length) {
        const target = queue.shift()!;
        const finish = (state: QuestionRestoreResult["state"]) => results.set(target.site, { site: target.site, state });
        if (!current()) { finish("cancelled"); continue; }
        const context = this.options.context(target.site), confirmedContext = expected.get(target.site);
        const latest = this.describe(plan.questionId, plan.answerId).targets.find(t => t.site === target.site);
        const wasPresent = data.contexts.find(c => c.site === target.site)?.context;
        const sameView = context?.id === confirmedContext?.id && (context?.url === confirmedContext?.url || (!wasPresent && context?.url === SITES.find(s => s.key === target.site)?.url));
        if (JSON.stringify(this.options.selection()) !== selected || !sameView || latest?.answerId !== target.answerId || latest?.url !== target.url) { finish("cancelled"); continue; }
        if (Date.now() >= deadline) { finish("timeout"); continue; }
        if (!target.url) { finish("missing_url"); continue; }
        if (this.options.context(target.site)?.url === target.url) { finish("already_open"); continue; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        this.inFlight.set(target.site, context?.id);
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { this.options.stop(target.site, context?.id); reject(new Error("timeout")); }, Math.min(15_000, Math.max(0, deadline - Date.now())));
          });
          await Promise.race([this.options.navigate(target.site, target.url), timeout]);
          finish(current() && this.options.context(target.site)?.id === context?.id ? "opened" : "cancelled");
        } catch (error) { finish(!current() ? "cancelled" : (error as Error).message === "timeout" ? "timeout" : "failed"); }
        finally { if (timer) clearTimeout(timer); this.inFlight.delete(target.site); }
      }
    };
    await Promise.all([worker(), worker()]);
    return data.targets.map(t => results.get(t.site)!);
  }
  cancel(): void {
    this.epoch++;
    this.plans.clear();
    for (const [site, contentsId] of this.inFlight) this.options.stop(site, contentsId);
    this.inFlight.clear();
  }
}
