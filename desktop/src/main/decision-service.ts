import { randomUUID } from "node:crypto";
import { isDecisionInput, type DecisionEvidence, type DecisionFilters, type DecisionInput, type DecisionRecord } from "../shared/decision";
import { getCopy } from "../shared/copy";
import type { ArchiveService } from "./archive-service";
import type { DecisionRepository } from "./decision-repository";

interface DecisionServiceOptions {
  readonly deviceId: () => string;
  readonly now?: () => number;
  readonly createId?: () => string;
}
export class DecisionService {
  private readonly now: () => number;
  private readonly createId: () => string;
  constructor(private readonly repository: DecisionRepository, private readonly archives: ArchiveService, private readonly options: DecisionServiceOptions) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  get(id: string): DecisionRecord | null {
    const record = this.repository.get(id);
    return record && !("deletedAt" in record) ? record : null;
  }

  search(filters: DecisionFilters = {}): DecisionRecord[] {
    const query = typeof filters.query === "string" ? filters.query.trim().toLocaleLowerCase() : "";
    return this.repository.list().filter(r => (!filters.archiveId || r.archiveId === filters.archiveId) &&
      (!filters.status || r.status === filters.status) && (!query ||
        [r.title,r.conclusion,r.rationale,r.uncertainties,r.nextStep,r.sourceTitle,...r.evidence.map(e=>e.excerpt)].join("\n").toLocaleLowerCase().includes(query)));
  }

  create(value: unknown): DecisionRecord {
    if (!isDecisionInput(value)) throw new Error("invalid_decision");
    const source = this.archives.get(value.archiveId);
    if (!source) throw new Error("archive_not_found");
    const now = this.now();
    const record: DecisionRecord = { ...this.fields(value), id:this.createId(), sourceTitle:[...(source.task || source.text)].slice(0,320).join(""),
      evidence:this.evidence(value), createdAt:now, updatedAt:now, deviceId:this.options.deviceId(), schema:2 };
    return this.repository.put(record) as DecisionRecord;
  }

  update(id: string, value: unknown): DecisionRecord {
    const current = this.get(id);
    if (!current) throw new Error("not_found");
    if (!isDecisionInput(value) || value.archiveId !== current.archiveId) throw new Error("invalid_decision");
    const record: DecisionRecord = {...current,...this.fields(value),evidence:this.evidence(value,current),
      updatedAt:Math.max(this.now(),current.updatedAt+1),deviceId:this.options.deviceId()};
    return this.repository.put(record) as DecisionRecord;
  }

  delete(id: string): void {
    if (!this.repository.delete(id,this.now(),this.options.deviceId())) throw new Error("not_found");
  }

  exportMarkdown(id: string, locale: string): string {
    const r = this.get(id);
    if (!r) throw new Error("not_found");
    const c = getCopy(locale);
    const status = r.status === "draft" ? c.decisionDraft : r.status === "verify" ? c.decisionVerify : c.decisionFinal;
    const lines = [`# ${r.title}`,status];
    for (const [label,text] of [[c.decisionConclusion,r.conclusion],[c.decisionRationale,r.rationale],[c.decisionUncertainties,r.uncertainties],[c.decisionNextStep,r.nextStep]])
      lines.push(`## ${label}`,text);
    lines.push(`## ${c.decisionEvidence}`,r.sourceTitle);
    if (!this.archives.get(r.archiveId)) lines.push(c.decisionSourceMissing);
    for (const e of r.evidence) lines.push(`### [S${e.resultIndex+1}] ${e.label}`,e.excerpt);
    return lines.join("\n\n");
  }

  private fields(v: DecisionInput): DecisionInput {
    return {archiveId:v.archiveId,title:v.title.trim(),conclusion:v.conclusion,rationale:v.rationale,uncertainties:v.uncertainties,
      nextStep:v.nextStep,status:v.status,evidence:v.evidence};
  }

  private evidence(value: DecisionInput, current?: DecisionRecord): DecisionEvidence[] {
    const source = this.archives.get(value.archiveId);
    return value.evidence.map(e => {
      if (!source) {
        const saved = current?.evidence.find(old => old.resultIndex === e.resultIndex && old.excerpt === e.excerpt);
        if (!saved) throw new Error("invalid_decision");
        return {...saved};
      }
      const answer = source.results[e.resultIndex];
      if (!answer?.text?.includes(e.excerpt)) throw new Error("invalid_decision");
      return {resultIndex:e.resultIndex,excerpt:e.excerpt,host:answer.host,label:answer.label,capturedAt:source.ts};
    });
  }
}
