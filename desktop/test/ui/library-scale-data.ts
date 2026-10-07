import { createArchiveRecord } from '../../src/shared/archive';
import type { DecisionRecord } from '../../src/shared/decision';
import type { FolderContent } from '../../src/shared/task-folder';

const base = createArchiveRecord({ text: 'Why is the sky blue?', task: 'Sky result 0000',
  results: [{ host: 'claude.ai', label: 'Claude', text: 'Rayleigh scattering.\n\nA complete, short saved answer.' },
    { host: 'chatgpt.com', label: 'ChatGPT', text: 'Small particles scatter short wavelengths more strongly.' }], createdAt: 1_000 },
  { id: 'result-0000', now: 1_000, deviceId: 'fixture' });
export function libraryScaleData(): FolderContent[] {
  const archives: FolderContent[] = Array.from({ length: 998 }, (_, index) => ({ kind: 'archive', record: createArchiveRecord({
    ...base, task: `Sky result ${String(index).padStart(4, '0')}`, ts: 1_000 + index,
    createdAt: 1_000 + index, updatedAt: 10_000 - index,
  }, { id: `result-${String(index).padStart(4, '0')}`, now: 10_000 - index, deviceId: 'fixture' }) }));
  const decision: DecisionRecord = { id: 'result-0000', archiveId: base.id, sourceTitle: base.task,
    title: 'Sky decision 998', conclusion: 'Keep the full source.', rationale: '', uncertainties: '', nextStep: '',
    status: 'draft', evidence: [], createdAt: 100, updatedAt: 101, deviceId: 'fixture', schema: 2 };
  return [...archives, { kind: 'decision', record: decision }, { kind: 'decision', record: {
    ...decision, id: 'decision-last', title: 'Sky decision 999', updatedAt: 100,
  } }];
}
