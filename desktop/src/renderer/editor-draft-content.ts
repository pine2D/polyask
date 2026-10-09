import type { DecisionInput } from '../shared/decision';
import { parseDraftInput } from '../shared/drafts';
import { COMPARISON_CATEGORIES, type ComparisonDraft } from './comparison-draft';
import type { SynthesisDraft } from './synthesis-draft';

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max?: number): value is string => typeof value === 'string' && (max === undefined || [...value].length <= max);
const strings = (value: unknown): value is Record<string, string> => record(value) && Object.values(value).every(v => text(v));

export function parseDecisionContent(value: unknown, archiveId: string): DecisionInput | null {
  // Editing labor uses the JSON resource cap; formal-save limits apply after recovery.
  value = parseDraftInput({ kind: 'decision', context: archiveId, title: '', content: value })?.content;
  if (!record(value) || value.archiveId !== archiveId || typeof value.title !== 'string' ||
    !['draft', 'verify', 'final'].includes(value.status) ||
    ![value.conclusion, value.rationale, value.uncertainties, value.nextStep].every(v => typeof v === 'string') ||
    !Array.isArray(value.evidence) || value.evidence.length > 9 || !value.evidence.every((v: unknown) =>
      record(v) && Number.isSafeInteger(v.resultIndex) && v.resultIndex >= 0 && v.resultIndex < 9 && typeof v.excerpt === 'string')) return null;
  return { archiveId, title: value.title, conclusion: value.conclusion, rationale: value.rationale,
    uncertainties: value.uncertainties, nextStep: value.nextStep, status: value.status,
    evidence: value.evidence.map((v: any) => ({ resultIndex: v.resultIndex, excerpt: v.excerpt })) };
}

export function parseComparisonContent(value: unknown, archiveId: string): ComparisonDraft | null {
  value = parseDraftInput({ kind: 'comparison', context: archiveId, title: '', content: value })?.content;
  if (!record(value) || value.archiveId !== archiveId || !Number.isSafeInteger(value.sourceUpdatedAt) || value.sourceUpdatedAt < 0 ||
    !text(value.judgment) || !text(value.nextStep) || !Array.isArray(value.quotes) || value.quotes.length > 9 ||
    !record(value.categories) || !Object.values(value.categories).every(v => Array.isArray(v) &&
      v.length <= 4 && v.every(c => COMPARISON_CATEGORIES.includes(c))) || !record(value.notes) ||
    !COMPARISON_CATEGORIES.every(c => strings(value.notes[c]))) return null;
  if (!value.quotes.every((v: unknown) => record(v) && v.archiveId === archiveId &&
    Number.isSafeInteger(v.sourceUpdatedAt) && Number.isSafeInteger(v.resultIndex) && v.resultIndex >= 0 && v.resultIndex < 9 &&
    Number.isSafeInteger(v.start) && Number.isSafeInteger(v.end) && v.start >= 0 && v.end > v.start &&
    text(v.host, 256) && text(v.label, 256) && text(v.excerpt) && typeof v.truncated === 'boolean')) return null;
  return structuredClone(value) as ComparisonDraft;
}

export function parseSynthesisContent(value: unknown): SynthesisDraft | null {
  value = parseDraftInput({ kind: 'synthesis', context: '', title: '', content: value })?.content;
  if (!record(value) || !Array.isArray(value.selectedHosts) || value.selectedHosts.length > 9 ||
    !value.selectedHosts.every(v => text(v, 256)) || new Set(value.selectedHosts).size !== value.selectedHosts.length ||
    !text(value.targetSite, 128) || (value.tier !== null && value.tier !== 'think' && value.tier !== 'fast') ||
    !text(value.instruction) || !text(value.excerpt)) return null;
  return { selectedHosts: [...value.selectedHosts], targetSite: value.targetSite, tier: value.tier,
    instruction: value.instruction, excerpt: value.excerpt };
}
