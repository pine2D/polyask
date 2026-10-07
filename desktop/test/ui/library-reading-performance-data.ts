import { createArchiveRecord, isArchiveRecord, type ArchiveRecord } from '../../src/shared/archive';
import { isStoredDecision, type DecisionRecord } from '../../src/shared/decision';
import type { FolderContent } from '../../src/shared/task-folder';

const sites = [ ['claude.ai', 'Claude'], ['chatgpt.com', 'ChatGPT'], ['gemini.google.com', 'Gemini'],
  ['chat.deepseek.com', 'DeepSeek'], ['www.doubao.com', '豆包'], ['www.qianwen.com', '千问'],
  ['www.kimi.com', 'Kimi'], ['yuanbao.tencent.com', '元宝'], ['chatglm.cn', '智谱'] ];
const bytes = (text: string) => new TextEncoder().encode(text).length;
function longAnswer(index: number, host: string): string {
  const heading = `# Complete synthetic answer ${index} from ${host}\n\n`;
  const block = `## Conditions and evidence\n\nThis complete paragraph from ${host} compares **assumptions** and [source](https://example.com/source). 保留全部来源与条件。\n\n- Observe the first condition.\n- Verify the second condition.\n\n> A quoted observation retains its original context.\n\n| Condition | Finding |\n| --- | --- |\n| first | supported |\n| second | uncertain |\n\n\`\`\`js\nconst evidence = "synthetic ${index}";\n\`\`\`\n\n`;
  const ending = `## End of complete answer ${index} from ${host}`;
  const count = Math.floor((32 * 1024 - bytes(heading) - bytes(ending)) / bytes(block));
  return heading + block.repeat(count) + ending;
}
export function libraryReadingPerformanceData() {
  const archives: ArchiveRecord[] = Array.from({ length: 500 }, (_, index) => createArchiveRecord({
    text: 'Performance question with full saved answers.', task: `Performance result ${String(index).padStart(3, '0')} ${index < 50 ? 'cohort-a' : 'cohort-b'}`,
    results: sites.map(([host, label]) => ({ host, label, text: index < 2 ? longAnswer(index, host)
      : `Short complete answer ${index} from ${host}.` })), createdAt: 1_000 + index,
  }, { id: `perf-archive-${index}`, now: 10_000 - index * 2, deviceId: 'synthetic' }));
  const decisions: DecisionRecord[] = archives.map((source, index) => ({ id: `perf-decision-${index}`,
    archiveId: source.id, sourceTitle: source.task, title: `Performance decision ${String(index).padStart(3, '0')} ${index < 50 ? 'cohort-a' : 'cohort-b'}`,
    conclusion: 'Retain full source context.', rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [],
    createdAt: 1_000 + index, updatedAt: 9_999 - index * 2, schema: 2, deviceId: 'synthetic' }));
  if (!archives.every(isArchiveRecord) || !decisions.every(isStoredDecision)) throw Error('post workload must use valid production records');
  const longSources = archives.slice(0, 2).flatMap(record => record.results.map(answer => answer.text!));
  const longBytes = longSources.map(bytes);
  if (longBytes.some(size => size < 31 * 1024 || size > 32 * 1024)) throw Error('post workload must retain nine complete near-32KiB answers per opened result');
  const items: FolderContent[] = [...archives.map(record => ({ kind: 'archive' as const, record })),
    ...decisions.map(record => ({ kind: 'decision' as const, record }))];
  return { items, archives, longSources, workload: { archives: 500, decisions: 500, total: 1000,
    longRecords: 2, answersPerRecord: 9, longBytes, shortAnswerMaximumBytes: Math.max(...archives.slice(2).flatMap(record => record.results.map(answer => bytes(answer.text!)))),
    source: 'new finite analogous synthetic workload; original pre-measurement fixture is unavailable' } };
}
