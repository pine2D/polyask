import type { ArchiveRecord } from '../shared/archive';
import type { DecisionRecord } from '../shared/decision';
import { answerSourceId } from '../shared/answer-source';
import { getCopy, formatCopy } from '../shared/copy';
import type { DesktopLocale } from '../shared/locale';
import { formatDateTime } from '../shared/format';
import { REPORT_EXPORT_COPY } from '../shared/report-export-copy';
import { reportLocaleTag } from '../shared/report-export';
import { describeCollectionCode } from '../shared/status-copy';
import { safeExternalUrl } from './security';
import { SITES } from './sites';
import { escapeReportText as escape, renderReportMarkdown as markdown } from './report-markdown';

export type ReportSource = { readonly kind: 'archive'; readonly archive: ArchiveRecord }
  | { readonly kind: 'decision'; readonly decision: DecisionRecord; readonly archive: ArchiveRecord | null };
export const MAX_REPORT_BYTES = 64 * 1024 * 1024;
export const REPORT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const STYLE = `
@page { size: A4; margin: 17mm 16mm 19mm; }
* { box-sizing: border-box; }
html { color-scheme: light; background: #fff; color: #172033; }
body { max-width: 860px; margin: 36px auto; padding: 0 28px; font: 15px/1.7 system-ui, sans-serif; overflow-wrap: anywhere; }
h1 { font-size: 28px; line-height: 1.3; margin: 0 0 12px; }
h2 { font-size: 21px; line-height: 1.4; margin: 30px 0 12px; border-bottom: 1px solid #d6dce5; padding-bottom: 6px; }
h3,h4,h5,h6 { line-height: 1.45; margin: 20px 0 8px; }
h1,h2,h3,h4,h5,h6,dt { break-after: avoid; }
p,li { orphans: 3; widows: 3; }
p { margin: 9px 0; }
header p,.metadata,.notice { color: #475569; }
.brand { font-size: 13px; letter-spacing: .04em; }
.notice { padding: 12px 16px; border: 1px solid #d6dce5; background: #f8fafc; border-radius: 6px; }
.metadata { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; font-size: 13px; }
dt,dd { margin: 0; }
.question,.excerpt { white-space: pre-wrap; }
blockquote { margin: 14px 0; border-left: 3px solid #94a3b8; padding: 4px 16px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f1f5f9; padding: 12px; border-radius: 4px; }
code { font: .9em/1.6 ui-monospace, monospace; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: .92em; margin: 14px 0; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th,td { border: 1px solid #cbd5e1; padding: 7px 9px; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f1f5f9; }
a { color: #1d4ed8; text-decoration: underline; }
footer { border-top: 1px solid #d6dce5; margin-top: 32px; padding-top: 12px; font-size: 12px; color: #475569; }
@media print { body { max-width: none; margin: 0; padding: 0; font-size: 10.5pt; } a { color: inherit; } }
`;

export function assertReportSize(source: ReportSource): void {
  if ((source.archive?.results.length ?? 0) > 9 || Buffer.byteLength(JSON.stringify(source), 'utf8') > MAX_REPORT_BYTES) {
    throw new Error('report_too_large');
  }
}

export function renderReportHtml(source: ReportSource, locale: DesktopLocale = 'en'): string {
  assertReportSize(source);
  const language = reportLocaleTag(locale), copy = getCopy(language), report = REPORT_EXPORT_COPY[locale];
  const date = (value: number) => formatDateTime(value, language);
  const metadata = (rows: readonly (readonly [string, string])[]) => `<dl class="metadata">${rows.map(([label, value]) =>
    `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
  const section = (title: string, content: string) => `<section><h2>${escape(title)}</h2>${content}</section>`;
  const title = source.kind === 'decision' ? source.decision.title : report.reportArchiveTitle;
  const record = source.kind === 'decision' ? source.decision : source.archive;
  const chunks = [metadata([[report.reportSavedAt, date(record.createdAt)], [report.reportUpdatedAt, date(record.updatedAt)]])];
  if (source.kind === 'decision') {
    const decision = source.decision;
    const status = { draft: copy.decisionDraft, verify: copy.decisionVerify, final: copy.decisionFinal }[decision.status];
    chunks.push(metadata([[copy.decisionStatus, status]]), `<p class="notice">${escape(copy.decisionManual)}</p>`);
    for (const [label, text] of [[copy.decisionConclusion, decision.conclusion], [copy.decisionRationale, decision.rationale],
      [copy.decisionUncertainties, decision.uncertainties], [copy.decisionNextStep, decision.nextStep]]) {
      chunks.push(section(label, markdown(text || '—')));
    }
    const evidence = decision.evidence.map(item => {
      const original = source.archive?.results[item.resultIndex];
      const changed = source.archive && (original?.host !== item.host || !original?.text?.includes(item.excerpt));
      return `<section><h3>${escape(`${answerSourceId(item.resultIndex)} ${item.label || item.host}`)}</h3>` +
        metadata([[report.reportSite, item.host], [report.reportCapturedAt, date(item.capturedAt)]]) +
        (changed ? `<p class="notice">${escape(report.reportEvidenceChanged)}</p>` : '') +
        `<blockquote class="excerpt">${escape(item.excerpt)}</blockquote></section>`;
    }).join('');
    chunks.push(section(copy.decisionEvidence, evidence || '<p>—</p>'));
    if (!source.archive) chunks.push(section(copy.archiveQuestion, `<p class="question">${escape(decision.sourceTitle)}</p>` +
      `<p class="notice">${escape(copy.decisionSourceMissing)}. ${escape(report.reportQuestionSnapshot)}</p>`));
  }
  const archive = source.archive;
  if (archive) {
    chunks.push(section(copy.archiveQuestion, `<p class="question">${escape(archive.task || archive.text)}</p>` +
      `<p class="metadata">${escape(formatCopy(copy.archiveCapturedAt, { time: date(archive.ts) }))}</p>`));
    if (archive.source) {
      const url = safeExternalUrl(archive.source.url), label = archive.source.title || archive.source.url;
      chunks.push(`<p>${escape(copy.archiveSource)}: ${url ? `<a href="${escape(url)}" rel="noreferrer noopener">${escape(label)}</a>` : escape(label)}</p>`);
      if (archive.source.truncated) chunks.push(`<p class="notice">${escape(report.reportSourceTruncated)}</p>`);
    }
    if (!archive.results.length) chunks.push(`<p>${escape(report.reportNoAnswers)}</p>`);
    archive.results.forEach((answer, index) => {
      const state = answer.state === 'think' ? copy.think : answer.state === 'fast' ? copy.fast : '';
      const available = !!answer.text?.trim();
      const completeness = answer.code === 'answer_truncated' ? copy.answerTruncated
        : available ? report.reportUnverified : report.reportMissingAnswer;
      const content = metadata([[report.reportSite, answer.host], [report.reportCompleteness, completeness]]) +
        (archive.winnerHost === answer.host && available ? `<p>${escape(report.reportUserSelected)}</p>` : '') +
        (answer.code && answer.code !== 'answer_truncated' ? `<p>${escape(describeCollectionCode(copy, answer.code))}</p>` : '') +
        (available ? markdown(answer.text!) : `<p>${escape(report.reportMissingAnswer)}</p>`);
      chunks.push(section(`${answerSourceId(index)} ${answer.label || answer.host}${state ? ` · ${state}` : ''}`, content));
    });
    if (archive.note.trim()) chunks.push(section(report.reportHumanNotes, markdown(archive.note)));
    if (archive.tags.length) chunks.push(metadata([[copy.archiveTags, archive.tags.join(', ')]]));
    if (archive.synthesis) {
      const synthesis = archive.synthesis, site = SITES.find(item => item.host === synthesis.host);
      chunks.push(section(copy.synthesisSaved, metadata([[report.reportSite, site?.label ?? synthesis.host],
        [report.reportSavedAt, date(synthesis.createdAt)], [report.reportCompleteness, report.reportUnverified]]) +
        `<p class="notice">${escape(copy.citationReportNotice)}</p>` +
        (synthesis.instruction ? `<blockquote class="excerpt">${escape(synthesis.instruction)}</blockquote>` : '') + markdown(synthesis.text)));
    }
  }
  const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">` +
    `<meta http-equiv="Content-Security-Policy" content="${escape(REPORT_CSP)}"><title>${escape(title)} · PolyAsk</title>` +
    `<style>${STYLE}</style></head><body><header><p class="brand">PolyAsk · ${escape(source.kind === 'decision' ? report.reportDecisionTitle : report.reportArchiveTitle)}</p>` +
    `<h1>${escape(title)}</h1><div class="notice"><p>${escape(report.reportScope)}</p><p>${escape(report.reportImages)}</p>` +
    `<p>${escape(report.reportRendering)}</p></div></header><main>${chunks.join('\n')}</main><footer>PolyAsk</footer></body></html>`;
  if (Buffer.byteLength(html, 'utf8') > MAX_REPORT_BYTES) throw new Error('report_too_large');
  return html;
}
