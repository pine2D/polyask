import type { ArchiveRecord } from '../shared/archive';
import type { DecisionInput } from '../shared/decision';
import { validateExcerpt, type ExactExcerpt } from './answer-excerpt';

export async function runExcerptNavigation(value: ExactExcerpt, effects: {
  readonly readSource: (id: string) => Promise<ArchiveRecord | null>;
  readonly active: () => boolean;
  readonly apply: (record: ArchiveRecord, value: ExactExcerpt) => void;
  readonly onUnavailable: (kind: 'missing' | 'changed' | 'invalid' | 'failed') => void;
}): Promise<void> {
  if (!effects.active()) return;
  try {
    const record = await effects.readSource(value.archiveId);
    if (!effects.active()) return;
    if (!record) effects.onUnavailable('missing');
    else if (record.id !== value.archiveId || record.updatedAt !== value.sourceUpdatedAt) effects.onUnavailable('changed');
    else if (!validateExcerpt(record, value)) effects.onUnavailable('invalid');
    else effects.apply(record, value);
  } catch { if (effects.active()) effects.onUnavailable('failed'); }
}

export function excerptDecisionDraft(record: ArchiveRecord, value?: ExactExcerpt): DecisionInput {
  return { archiveId: record.id, title: [...(record.task || record.text)].slice(0, 160).join(''),
    conclusion: '', rationale: '', uncertainties: '', nextStep: '', status: 'draft',
    evidence: value ? [{ resultIndex: value.resultIndex, excerpt: value.excerpt }] : [] };
}
