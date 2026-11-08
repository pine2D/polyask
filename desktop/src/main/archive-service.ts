import { randomUUID } from "node:crypto";

import type { ArchiveRepository } from "./archive-repository";
import {
  createArchiveRecord,
  updateArchiveRecord,
  type ArchiveFilters,
  type ArchiveInput,
  type ArchivePatch,
  type ArchiveRecord,
  type ArchiveSearchResult
} from "../shared/archive";
import { getCopy } from "../shared/copy";
import { describeCollectionCode } from "../shared/status-copy";
import { SITES } from "./sites";
import { answerSourceId } from "../shared/answer-source";
import { observationDescription, observationTime } from '../shared/question-observation-display';
import { markdownText, safeExportMarkdown } from './markdown-export-format';
import { safeExternalUrl } from './security';

interface ArchiveServiceOptions {
  readonly deviceId: () => string;
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class ArchiveService {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly repository: ArchiveRepository,
    private readonly options: ArchiveServiceOptions
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
  }

  search(filters: ArchiveFilters = {}): ArchiveSearchResult {
    return { items: this.repository.search(filters), tags: this.tags() };
  }

  tags(): string[] { return this.repository.tags(); }

  get(id: string): ArchiveRecord | null {
    const record = this.repository.get(id);
    return record && !("deletedAt" in record) ? record : null;
  }

  add(input: ArchiveInput): ArchiveRecord {
    const now = this.now();
    const record = createArchiveRecord(input, {
      id: this.createId(),
      now,
      deviceId: this.options.deviceId()
    });
    return this.repository.put(record) as ArchiveRecord;
  }

  update(id: string, patch: ArchivePatch): ArchiveRecord {
    const current = this.get(id);
    if (!current) throw new Error("not_found");
    const next = updateArchiveRecord(current, patch, {
      now: this.now(),
      deviceId: this.options.deviceId()
    });
    return this.repository.put(next) as ArchiveRecord;
  }

  delete(id: string): void {
    if (!this.repository.delete(id, this.now(), this.options.deviceId())) throw new Error("not_found");
  }

  exportMarkdown(id: string, locale: string): string {
    const record = this.get(id);
    if (!record) throw new Error("not_found");
    const copy = getCopy(locale);
    const markdown = [`# ${copy.archiveQuestion}`, ...[...new Set([record.task, record.text])].filter(Boolean).map(markdownText)];
    if (record.source) {
      const url = safeExternalUrl(record.source.url), label = markdownText(record.source.title || url || copy.archiveSource);
      markdown.push(`**${copy.archiveSource}**: ${url ? `[${label}](<${url}>)` : label}`);
    }
    for (const [index, result] of record.results.entries()) {
      const tier = result.state === "think" ? ` · ${copy.think}` : result.state === "fast" ? ` · ${copy.fast}` : "";
      markdown.push(`## ${markdownText(result.label)}${tier}`);
      markdown.push(answerSourceId(index));
      markdown.push(markdownText(observationDescription(result.observation, copy)));
      if (result.observation) markdown.push(markdownText(observationTime(result.observation, copy, locale)), markdownText(copy.observationNote));
      if (record.winnerHost === result.host && result.text?.trim()) markdown.push(`**${copy.archiveBestAnswer}**`);
      markdown.push(result.text?.trim() ? safeExportMarkdown(result.text, 2) : `> ${describeCollectionCode(copy, result.code)}`);
      if (result.code === "answer_truncated") markdown.push(`> ${copy.answerTruncated}`);
    }
    const synthesis = record.synthesis;
    if (synthesis) {
      const tier = synthesis.state === "think" ? copy.think : synthesis.state === "fast" ? copy.fast : "";
      const site = SITES.find((candidate) => candidate.host === synthesis.host);
      markdown.push(`## ${copy.synthesisSaved}`);
      markdown.push(`> ${copy.citationReportNotice}`);
      markdown.push(`**${copy.synthesisTarget}**: ${markdownText(site?.label ?? synthesis.host)}${tier ? ` · ${tier}` : ""}`);
      markdown.push(safeExportMarkdown(synthesis.text, 2));
    }
    return markdown.join("\n\n");
  }
}
