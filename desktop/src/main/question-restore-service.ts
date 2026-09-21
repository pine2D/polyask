import { randomUUID } from "node:crypto";
import type { SiteKey } from "../shared/contracts";
import type { QuestionRestorePreview, QuestionRestoreResult } from "../shared/question-restore";
import { safeQuestionUrl } from "./question-navigation";
import type { QuestionRepository } from "./question-repository";

interface RestoreOptions {
  selection: () => readonly SiteKey[];
  select: (sites: readonly SiteKey[]) => void;
  context: (site: SiteKey) => { id: number; url: string } | null;
  navigate: (site: SiteKey, url: string) => Promise<void>;
  stop: (site: SiteKey) => void;
  beforeNavigate: (sites: readonly SiteKey[]) => Promise<void>;
}
interface Plan { questionId: string; answerId?: string; signature: string; needsConfirmation: boolean }
export class QuestionRestoreService {
  private readonly plans = new Map<string, Plan>();
  private readonly inFlight = new Set<SiteKey>();
  private epoch = 0;
  constructor(private readonly repository: QuestionRepository, private readonly options: RestoreOptions) {}
  private describe(questionId: string, answerId?: string) {
    const record = this.repository.get(questionId);
    if (!record || "deletedAt" in record) throw new Error("history_not_found");
    const answers = this.repository.answers(questionId);
    const chosen = answerId ? answers.find(a => a.id === answerId) : null;
    if (answerId && !chosen) throw new Error("history_not_found");
    const sites = chosen ? [chosen.site] : record.sites;
    const selection = chosen ? [...new Set([...this.options.selection(), chosen.site])] : [...sites];
    const targets = sites.map(site => {
      const answer = chosen ?? answers.filter(a => a.site === site).at(-1);
      return { site, url: answer?.conversationUrl ? safeQuestionUrl(site, answer.conversationUrl) : null,
        answerId: answer?.id, updatedAt: answer?.updatedAt };
    });
    const contexts = [...new Set([...this.options.selection(), ...sites])].map(site => ({ site, context: this.options.context(site) }));
    const affected = contexts.filter(({ site, context }) => context &&
      (!selection.includes(site) || targets.some(t => t.site === site && t.url && t.url !== context.url))).map(item => item.site);
    return { record, sites: selection, targets, affected, signature: JSON.stringify([record.updatedAt, targets, contexts, this.options.selection()]) };
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
    const epoch = ++this.epoch, deadline = Date.now() + 30_000;
    const current = () => {
      const q = this.repository.get(plan.questionId);
      return epoch === this.epoch && q && !("deletedAt" in q);
    };
    await this.options.beforeNavigate(data.affected);
    if (!current()) return data.targets.map(t => ({ site: t.site, state: "cancelled" }));
    this.options.select(data.sites);
    const queue = [...data.targets], results = new Map<SiteKey, QuestionRestoreResult>();
    const worker = async () => {
      while (queue.length) {
        const target = queue.shift()!;
        const finish = (state: QuestionRestoreResult["state"]) => results.set(target.site, { site: target.site, state });
        if (!current()) { finish("cancelled"); continue; }
        if (Date.now() >= deadline) { finish("timeout"); continue; }
        if (!target.url) { finish("missing_url"); continue; }
        if (this.options.context(target.site)?.url === target.url) { finish("already_open"); continue; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        this.inFlight.add(target.site);
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { this.options.stop(target.site); reject(new Error("timeout")); }, Math.min(15_000, Math.max(0, deadline - Date.now())));
          });
          await Promise.race([this.options.navigate(target.site, target.url), timeout]);
          finish(current() ? "opened" : "cancelled");
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
    for (const site of this.inFlight) this.options.stop(site);
    this.inFlight.clear();
  }
}
