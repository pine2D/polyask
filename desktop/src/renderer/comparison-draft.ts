import type { ArchiveRecord } from '../shared/archive';
import type { DesktopCopy } from '../shared/copy';
import type { DecisionInput } from '../shared/decision';
import { answerSourceId } from '../shared/answer-source';
import { validateExcerpt, type ExactExcerpt } from './answer-excerpt';

export const COMPARISON_CATEGORIES = ['conclusion', 'evidence', 'conditions', 'cost'] as const;
export type ComparisonCategory = typeof COMPARISON_CATEGORIES[number];
export interface ComparisonDraft {
  readonly archiveId: string;
  readonly sourceUpdatedAt: number;
  readonly quotes: readonly ExactExcerpt[];
  readonly categories: Readonly<Record<string, readonly ComparisonCategory[]>>;
  readonly notes: Readonly<Record<ComparisonCategory, Readonly<Record<string, string>>>>;
  readonly judgment: string;
  readonly nextStep: string;
}
export function emptyComparisonDraft(record: ArchiveRecord): ComparisonDraft {
  return { archiveId: record.id, sourceUpdatedAt: record.updatedAt, quotes: [], categories: {},
    notes: { conclusion: {}, evidence: {}, conditions: {}, cost: {} }, judgment: '', nextStep: '' };
}
export function comparisonCategoryLabel(copy: DesktopCopy, category: ComparisonCategory): string {
  return category === 'conclusion' ? copy.manualConclusion : category === 'evidence' ? copy.manualEvidence
    : category === 'conditions' ? copy.manualConditions : copy.manualCost;
}
export function comparisonDecisionInput(record: ArchiveRecord, draft: ComparisonDraft, copy: DesktopCopy): DecisionInput | null {
  const indices = draft.quotes.map(quote => quote.resultIndex);
  if (record.id !== draft.archiveId || draft.quotes.some(quote => !validateExcerpt(record, quote))
    || new Set(indices).size !== indices.length || indices.length > 9) return null;
  const section = (category: ComparisonCategory) => {
    const notes = record.results.flatMap((source, index) => {
      const note = draft.notes[category][source.host];
      return note?.trim() ? [`${answerSourceId(index)} ${source.label}\n${note}`] : [];
    });
    return notes.length ? `${comparisonCategoryLabel(copy, category)}\n${notes.join('\n\n')}` : '';
  };
  return { archiveId: record.id, title: [...(record.task || record.text)].slice(0, 160).join(''), status: 'draft',
    conclusion: draft.judgment, rationale: ['conclusion', 'evidence', 'cost'].map(category => section(category as ComparisonCategory)).filter(Boolean).join('\n\n'),
    uncertainties: section('conditions'), nextStep: draft.nextStep,
    evidence: [...draft.quotes].sort((a, b) => a.resultIndex - b.resultIndex).map(quote => ({ resultIndex: quote.resultIndex, excerpt: quote.excerpt })) };
}
