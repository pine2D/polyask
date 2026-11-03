import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { QuestionHistory } from '../../src/renderer/question-history';
import { FeedbackProvider } from '../../src/renderer/feedback-provider';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { createArchiveRecord } from '../../src/shared/archive';
import type { FolderFilters } from '../../src/shared/task-folder';
import { SITES } from '../../src/main/sites';
import { withFolderPages } from './library-page-api';
import '../../src/renderer/styles.css';
import '../../src/renderer/accessibility.css';

const query = new URLSearchParams(location.search), locale = query.get('locale') || 'zh-CN';
document.documentElement.lang = locale;
document.documentElement.dataset.platform = 'win32';
document.documentElement.dataset.density = query.get('density') || 'compact';
const copy = getCopy(locale);
const basePrompt = '如何为团队建立可靠的知识库？请比较三种实施方案，说明适用条件、成本、局限和验证步骤。';
const prompt = query.get('state') === 'long' ? (basePrompt + '\n').repeat(12) : basePrompt;
const review = { copy, clipboard: [] as string[], failCopy: false, failRead: query.get('state') === 'failure', holdRead: '', releaseRead: null as (() => void) | null };
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => {
  if (review.failCopy) throw Error('synthetic_clipboard_failure'); review.clipboard.push(text);
} } });
const body = [
  '# 团队知识库的实施建议',
  '建议先明确资料的使用场景，再决定存储、检索和更新方式。需要同时考虑日常查询、多人协作、版本追踪和离线访问，避免为了收集资料增加维护负担。',
  '## 一、先确定使用范围',
  '把经常被重复询问的问题、正在执行的工作和需要长期留存的规范分开管理。每份资料注明来源、适用日期和负责人；遇到互相矛盾的说法时，保留原始证据，暂不合并结论。',
  '### 三种可行方案',
  '| 方案 | 适用场景 | 维护成本 | 主要限制 |\n| --- | --- | --- | --- |\n| 本地 Markdown | 个人研究、小型团队 | 低，文件可独立备份 | 协同编辑需要约定 |\n| 共享文档平台 | 多人共同维护 | 中，需管理权限 | 导出与迁移能力需验证 |\n| 自建检索服务 | 大量历史资料 | 高，需持续运维 | 数据治理决定检索效果 |',
  '## 二、按最小范围试运行',
  '1. 选取十份常用资料，统一标题、日期与来源。\n2. 请两位同事分别完成查询任务。\n   - 记录查到正确答案所用的时间。\n   - 记录误读、重复和遗漏的位置。\n3. 一周后根据实际使用情况决定是否扩大范围。',
  '> 验收时应回到具体任务：读者能否找到资料、理解适用条件，并确认原始出处。',
  '### 示例：校验文件索引',
  '```ts\nconst records = await readIndex();\nfor (const record of records) {\n  if (!record.source || !record.updatedAt) {\n    console.warn("资料缺少来源或日期", record.title);\n  }\n}\n```',
  '### 评估结果与后续安排',
  '使用相同的一组任务比较三种方案。把查找时间、更新成本和错误率分别记录，不把单次成功当作稳定可用的证据。',
  '$$ R = \\frac{N_{correct}}{N_{total}} $$',
  '[试运行说明](https://example.com/guide) · [验收记录](https://example.com/review)',
  ...Array.from({length: 8}, (_, i) => `## 补充说明 ${i + 1}\n\n资料规模增长后，仍应保持原有链接可用。定期检查失效来源、过期建议和重复条目，变更时保留必要的历史记录。对尚未验证的结论标注不确定性。`)
].join('\n\n');
const now = 1793538000000;
let archives = Array.from({length: 8}, (_, i) => createArchiveRecord({task: i ? ['团队文档的分类与命名约定', '比较本地与云端检索方案', '知识库更新与责任分工'][i % 3] : prompt,
  text: prompt, results: SITES.map((s, n) => ({host: s.host, label: s.label, text: body + (n ? '\n\n本来源补充：关注迁移与导出能力。' : ''), state: 'think'})), tags: ['知识管理'], note: '', favorite: i === 0}, {id: `r${i}`, now: now - i * 86400000, deviceId: 'synthetic-review'})).map((record, i) => ({...record, favorite: i === 0, tags: ['知识管理']}));
const rows = archives.map((record, i) => ({schema: 4, id: `q${i}`, text: record.task, sites: SITES.map(s => s.key), requestedTier: null,
  inputImageCount: 0, createdAt: now - i * 86400000, updatedAt: now, deviceId: 'synthetic-review', savedSites: 9, answers: []}));
function detail(id: string, selected?: string) {
  const question = rows.find(q => q.id === id) || rows[0];
  const answers = SITES.map((s, i) => ({schema: 4, id: `${id}-${s.key}`, questionId: id, site: s.key, attempt: 1,
    createdAt: question.createdAt, updatedAt: now, deviceId: 'synthetic-review', submission: 'submitted', submissionCode: null,
    capture: 'complete', captureCode: null, conversationUrl: `https://example.com/synthetic/${s.key}`,
    answerMarkdown: !selected || selected === `${id}-${s.key}` ? body : null, capturedAt: now, sealedAt: now, truncated: false}));
  return {question, answers, ...(selected ? {loadedAnswerId: selected} : {})};
}
setShellApi(withFolderPages({
  setQuestionPanel: async () => {}, setSurface: async () => {}, onQuestionSaveFailed: () => () => {},
  listLegacyQuestions: async () => ({items: [], cursor: null}), listQuestions: async ({query: text = ''}: {query?: string}) => ({items: query.get('state') === 'empty' ? [] : rows.filter(q => q.text.includes(text)), cursor: null}),
  getQuestion: async (id: string, selected?: string) => {
    if (id === review.holdRead) await new Promise<void>(resolve => { review.releaseRead = resolve; });
    if (review.failRead) throw Error('synthetic_read_failure'); return detail(id, selected); },
  listFolders: async () => [{schema: 3, id: 'work', name: '团队研究', createdAt: now, updatedAt: now, deviceId: 'synthetic-review'}],
  listArchiveTags: async () => ['知识管理'], searchFolderContents: async (filters: FolderFilters) => query.get('state') === 'empty' || filters.kind === 'decision' || filters.status || filters.folderId === 'work' ? []
    : archives.filter(record => (!filters.query || record.task.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase()))
      && (!filters.favorite || record.favorite) && (!filters.tag || record.tags.includes(filters.tag))).map(record => ({kind: 'archive', record})),
  getArchive: async (id: string) => archives.find(r => r.id === id), folderMemberships: async () => [],
  updateArchive: async (id: string, patch: any) => { archives = archives.map(r => r.id === id ? {...r, ...patch} : r); return archives.find(r => r.id === id); },
  openExternal: async () => {}, previewMarkdown: async () => { throw Error('synthetic_export_unavailable'); }
}) as any);
const app = query.get('surface') === 'history' ? <QuestionHistory open copy={copy} sites={SITES} draft="" busy={false} locale={locale}
  onBlockingChange={() => {}} onOpen={() => {}} onClose={() => {}} onDraft={() => {}} /> :
  <ArchiveSurface copy={copy} locale={locale} preferredId="r0" sites={SITES} synthesisSites={SITES} defaultTier="think"
    pendingSynthesis={null} synthesisCandidate={null} onClose={() => {}} onCapture={async () => archives[0]}
    onSendSynthesis={async () => {}} onCollectSynthesis={async () => {}} onSaveSynthesis={async () => archives[0]} />;
(window as any).review = review;
createRoot(document.getElementById('root')!).render(<FeedbackProvider copy={copy}>{app}</FeedbackProvider>);
