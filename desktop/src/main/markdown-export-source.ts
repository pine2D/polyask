import { createHash } from 'node:crypto';
import type { ArchiveService } from './archive-service';
import type { DecisionService } from './decision-service';
import type { QuestionRepository } from './question-repository';
import type { MarkdownDocument, MarkdownEntry, MarkdownTarget, MarkdownSelection } from '../shared/markdown-export';
import { MAX_MARKDOWN_BYTES } from '../shared/markdown-export';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { SITES } from './sites';
import { markdownText, safeExportMarkdown } from './markdown-export-format';
import { safeExternalUrl } from './security';

export interface MarkdownRepositories {
  readonly questions: Pick<QuestionRepository, 'get' | 'getAnswer' | 'exportAnswers'>;
  readonly archives: Pick<ArchiveService, 'get'>;
  readonly decisions: Pick<DecisionService, 'get'>;
}
const revision = (r: { id: string; updatedAt: number; createdAt: number; deviceId: string }) =>
  createHash('sha256').update(JSON.stringify([r.id, r.updatedAt, r.createdAt, r.deviceId])).digest('hex');
const found = <T>(r: T | null): T => { if (!r || typeof r === 'object' && 'deletedAt' in r) throw new Error('markdown_not_found'); return r; };
export function assertMarkdownSize(text: string): void { if (Buffer.byteLength(text, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('markdown_too_large'); }
const title = (text: string) => [...text.replace(/\s+/g, ' ').trim()].slice(0, 160).join('');
const stamp = (time: number) => new Date(time).toISOString();
export class MarkdownSources {
  constructor(private readonly repos: MarkdownRepositories) {}
  preview(target: MarkdownTarget, copy: DesktopCopy): MarkdownDocument {
    if (target.kind === 'history') {
      const q = found(this.repos.questions.get(target.id));
      if ('deletedAt' in q) throw new Error('markdown_not_found');
      const answers = this.repos.questions.exportAnswers(q.id).filter(a => q.sites.includes(a.site));
      const latest = new Map<string, number>();
      for (const a of answers) latest.set(a.site, Math.max(latest.get(a.site) ?? 0, a.attempt));
      const entries: MarkdownEntry[] = answers.map(a => ({ id: a.id, site: a.site, kind: 'answer',
        label: SITES.find(s => s.key === a.site)?.label ?? a.site, available: a.hasText,
        attempt: a.attempt, latestAttempt: latest.get(a.site),
        capturedAt: a.capturedAt, state: a.capture, truncated: a.truncated }));
      return { target, revision: '', title: title(q.text), createdAt: q.createdAt, updatedAt: q.updatedAt, deviceId: q.deviceId, entries };
    }
    if (target.kind === 'archive') {
      const r = found(this.repos.archives.get(target.id));
      const entries: MarkdownEntry[] = r.results.map((a, index) => ({ id: `result:${index}`, site: SITES.find(s => s.host === a.host)?.key ?? a.host,
        label: a.label || a.host, kind: 'answer', available: !!a.text?.trim(), capturedAt: r.ts,
        state: 'unknown', truncated: a.code === 'answer_truncated', best: r.winnerHost === a.host }));
      if (r.synthesis) entries.push({ id: 'synthesis', site: '__synthesis', label: copy.markdownSynthesis, kind: 'synthesis',
        available: !!r.synthesis.text.trim(), capturedAt: r.synthesis.createdAt, state: 'unknown', truncated: false });
      return { target, revision: revision(r), title: title(r.task || r.text), createdAt: r.ts, updatedAt: r.updatedAt, deviceId: r.deviceId, entries };
    }
    const r = found(this.repos.decisions.get(target.id));
    return { target, revision: revision(r), title: title(r.title), createdAt: r.createdAt, updatedAt: r.updatedAt, deviceId: r.deviceId, entries: [
      { id: 'decision', site: '__decision', label: copy.decisionTitle, kind: 'decision', available: true,
        capturedAt: r.createdAt, state: 'unknown', truncated: false }] };
  }
  alive(selection: MarkdownSelection): boolean {
    const { target } = selection;
    if (target.kind === 'archive') return !!this.repos.archives.get(target.id);
    if (target.kind === 'decision') return !!this.repos.decisions.get(target.id);
    const q = this.repos.questions.get(target.id);
    return !!q && !('deletedAt' in q) && selection.entryIds.every(id => {
      const a = this.repos.questions.getAnswer(id);
      return !!a && !('deletedAt' in a) && a.questionId === q.id && q.sites.includes(a.site);
    });
  }
  read(selection: MarkdownSelection, copy: DesktopCopy): { document: MarkdownDocument; markdown: string } {
    const document = this.preview(selection.target, copy);
    if (selection.target.kind !== 'history' && selection.revision !== document.revision) throw new Error('markdown_source_changed');
    const entries = selection.entryIds.map(id => found(document.entries.find(e => e.id === id && e.available) ?? null));
    if (!entries.length) throw new Error('markdown_empty');
    if (selection.target.kind === 'history' && new Set(entries.map(e => e.site)).size !== entries.length) throw new Error('invalid_request');
    const lines = [`## ${markdownText(document.title)}`, `${copy.reportCapturedAt}: ${stamp(document.createdAt)}`];
    const selected = new Set(entries.map(e => e.id));
    const excluded = [...new Set(document.entries.filter(e => e.kind === 'answer' && !entries.some(a => a.site === e.site)).map(e => e.label))];
    if (excluded.length) lines.push(`> ${copy.markdownExcluded}: ${excluded.map(markdownText).join(', ')}`);
    if (selection.target.kind === 'history') {
      const q = found(this.repos.questions.get(selection.target.id));
      if ('deletedAt' in q) throw new Error('markdown_not_found');
      if (q.text !== document.title) lines.push(markdownText(q.text));
      if (q.inputImageCount) lines.push(formatCopy(copy.questionImages, { count: q.inputImageCount }));
      for (const entry of entries) {
        const a = found(this.repos.questions.getAnswer(entry.id));
        if ('deletedAt' in a || a.questionId !== q.id || !q.sites.includes(a.site) || !a.answerMarkdown?.trim()) throw new Error('markdown_source_changed');
        const tier = q.requestedTier === 'think' ? copy.think : q.requestedTier === 'fast' ? copy.fast : '';
        lines.push(`### ${markdownText(entry.label)}`, formatCopy(copy.questionAttempt, { number: a.attempt }),
          `${copy.reportCapturedAt}: ${stamp(a.capturedAt!)}`, this.status(entry, copy));
        if (tier) lines.push(`${copy.markdownRequestedTier}: ${tier}`);
        const link = a.conversationUrl && safeExternalUrl(a.conversationUrl);
        if (link) lines.push(`[${copy.archiveSource}](<${link}>)`);
        assertMarkdownSize(a.answerMarkdown); lines.push(safeExportMarkdown(a.answerMarkdown));
      }
    } else if (selection.target.kind === 'archive') {
      const r = found(this.repos.archives.get(selection.target.id));
      for (const text of new Set([r.task, r.text])) if (text && text !== document.title) lines.push(markdownText(text));
      if (r.tags.length) lines.push(`${copy.archiveTags}: ${r.tags.map(markdownText).join(', ')}`);
      if (r.note) lines.push(`### ${copy.reportHumanNotes}`, markdownText(r.note));
      const link = r.source && safeExternalUrl(r.source.url);
      if (link) lines.push(`[${markdownText(r.source!.title || copy.archiveSource)}](<${link}>)`);
      if (r.source?.truncated) lines.push(`> ${copy.reportSourceTruncated}`);
      for (const entry of entries) {
        const index = Number(entry.id.split(':')[1]), answer = r.results[index];
        const body = entry.kind === 'synthesis' ? r.synthesis!.text : answer.text!;
        const state = entry.kind === 'synthesis' ? r.synthesis!.state : answer.state;
        const tier = state === 'think' ? copy.think : state === 'fast' ? copy.fast : '';
        lines.push(`### ${entry.kind === 'answer' ? `[S${index + 1}] ` : ''}${markdownText(entry.label)}${tier ? ` · ${tier}` : ''}`, this.status(entry, copy));
        if (entry.best) lines.push(`> ${copy.reportUserSelected}`);
        if (entry.kind === 'synthesis' && document.entries.some(e => e.kind === 'answer' && e.available && !selected.has(e.id))) lines.push(`> ${copy.markdownSynthesisWarning}`);
        assertMarkdownSize(body); lines.push(safeExportMarkdown(body));
      }
    } else {
      const r = found(this.repos.decisions.get(selection.target.id));
      lines.push(r.status === 'final' ? copy.decisionFinal : r.status === 'verify' ? copy.decisionVerify : copy.decisionDraft);
      for (const [label, value] of [[copy.decisionConclusion, r.conclusion], [copy.decisionRationale, r.rationale],
        [copy.decisionUncertainties, r.uncertainties], [copy.decisionNextStep, r.nextStep]]) {
        assertMarkdownSize(value); lines.push(`### ${label}`, safeExportMarkdown(value));
      }
      lines.push(`### ${copy.decisionEvidence}`, markdownText(r.sourceTitle));
      if (!this.repos.archives.get(r.archiveId)) lines.push(`> ${copy.decisionSourceMissing}`);
      for (const e of r.evidence) { assertMarkdownSize(e.excerpt); lines.push(`#### [S${e.resultIndex + 1}] ${markdownText(e.label)}`, safeExportMarkdown(e.excerpt, 4)); }
    }
    const markdown = lines.filter(Boolean).join('\n\n'); assertMarkdownSize(markdown);
    return { document, markdown };
  }
  private status(entry: MarkdownEntry, c: DesktopCopy): string {
    const states: Record<string, string> = { complete: c.questionStateComplete, partial: c.questionStatePartial, interrupted: c.questionStateInterrupted };
    return `> ${states[entry.state] ?? c.reportUnverified}${entry.truncated ? ` · ${c.questionTruncated}` : ''}`;
  }
}
