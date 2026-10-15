import { withFolderPages } from './library-page-api';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveSurface } from '../../src/renderer/archive-surface';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { createArchiveRecord } from '../../src/shared/archive';
import '../../src/renderer/styles.css';
import '../../src/renderer/accessibility.css';
const state = { failSave: false, failLoad: false, failMarkdown: false, failExternal: false, writes: 0, folderWrites: 0, links: [] as string[] };
(window as any).libraryTest = state;
const typography = [
  'A saved answer should remain comfortable to read when the workspace grows wider. Compare the evidence, assumptions, and limitations before recording a decision. Keep the complete source available so that another reading can check the reasoning. Clear paragraphs make it easier to return to the next line without losing your place.',
  '### 实施范围 · Scope', '保留原有系统字体、完整回答与操作路径。',
  '#### 验证细节 · Validation', '检查三语换行、窄窗阅读、缩放和长代码。'
].join('\n\n');
const text = '# 方案建议\n\n优先改善结果阅读体验，保留已确认的文件夹与决策卡能力。**可读性**比装饰更重要。\n\n| 方案 | 成本 | 结论 |\n| --- | --- | --- |\n| 修补样式 | 低 | 局部改善 |\n| 整理工作区 | 中 | 推荐 |\n\n1. 统一布局和控件\n2. 完善正文渲染\n   - 保留列表层级\n   - 支持安全链接\n\n> 比较不同回答，保留来源与证据。\n\n```ts\nconst result = await compare(answers);\n```\n\n[参考文档](https://example.com/docs)' + '\n\n' + typography;
let records = Array.from({length: 8}, (_, i) => createArchiveRecord({ id: `result-${i}`, task: i ? `产品优化调研 ${i}：在信息密度与阅读舒适度之间取得平衡` : '如何改善 AI 多模型结果库的阅读与比较体验？', text: '请比较优化方案', results: ['Claude', 'ChatGPT', 'Gemini', 'DeepSeek', 'Kimi', 'Doubao', 'Qianwen', 'Yuanbao', 'Zhipu'].map((label, j) => ({ host: `${label.toLowerCase()}.com`, label, text: text + (j ? '\n\n另一份独有的建议。' : ''), state: 'think' })), tags: ['产品设计', '待讨论', '长标签用于验证布局不能溢出容器'], note: '保留原有数据契约。', favorite: i === 0, ts: Date.now() - i * 86400000, createdAt: Date.now(), updatedAt: Date.now(), deviceId: 'fixture' }, {id: `result-${i}`, now: Date.now(), deviceId: 'fixture'}));
if (new URLSearchParams(location.search).has('longCode')) records = records.map(record => ({ ...record,
  results: record.results.map(result => ({ ...result, text: `${result.text}\n\n\`\`\`text\n${'unbroken_'.repeat(250)}\n\`\`\`` })) }));
records=records.map(r=>({...r,tags:['产品设计','待讨论'], note:'保留原有数据契约。',favorite:true}));
if (new URLSearchParams(location.search).has('invalidTime')) records = records.map(record => ({ ...record,
  ts: Number.MAX_SAFE_INTEGER, createdAt: Number.MAX_SAFE_INTEGER, updatedAt: Number.MAX_SAFE_INTEGER }));
const folders = [{ id: 'work', name: '产品设计与体验改进', createdAt: 1, updatedAt: 1, deviceId: 'fixture', schema: 3 }];
let cards = [{ id: 'card-1', archiveId: records[0].id, title: '结果库体验优化决策', conclusion: '采用阅读优先的三栏布局。', rationale: '统一组件，减少重复操作。', uncertainties: '不同系统缩放下的效果待核实。', nextStep: '完成浏览器与 Electron 验证。', status: 'draft', evidence: [], sourceTitle: records[0].task, createdAt: Date.now(), updatedAt: Date.now(), deviceId: 'fixture', schema: 2 }];
if (new URLSearchParams(location.search).has('colorStates')) cards = ['draft', 'verify', 'final'].map((status, i) => ({
  ...cards[0], id: `card-${i + 1}`, title: `${cards[0].title} · ${status}`, status }));
if (new URLSearchParams(location.search).has('emptyLibrary')) { records = []; cards = []; }
let memberships: string[] = [];
setShellApi(withFolderPages({
  listFolders: async () => { if (state.failLoad) throw new Error('fixture_load_failed'); return folders; },
  createFolder: async (name: string) => { state.folderWrites++; const folder = { id: `folder-${state.folderWrites}`, name, createdAt: Date.now(), updatedAt: Date.now(), deviceId: 'fixture', schema: 3 }; folders.push(folder); return folder; },
  renameFolder: async (id: string, name: string) => { state.folderWrites++; const folder = folders.find(item => item.id === id); if (!folder) throw Error('not_found'); Object.assign(folder, { name, updatedAt: Date.now() }); return folder; },
  // 搜索/翻页只重查内容（R24 起不再重取文件夹列表），列表加载失败要在这一层模拟。
  searchFolderContents: async (filters: any) => { if (state.failLoad) throw new Error('fixture_load_failed'); return [...records.map(record => ({kind:'archive',record})), ...cards.map(record => ({kind:'decision',record}))].filter(item => (!filters.kind || item.kind === filters.kind) && (!filters.query || JSON.stringify(item).includes(filters.query))); },
  searchArchives: async () => ({items: records, tags: ['产品设计', '待讨论', '很长的标签用于验证下拉菜单内容能够换行且不会撑破窗口边缘']}),
  listArchiveTags: async () => ['产品设计', '待讨论', '很长的标签用于验证下拉菜单内容能够换行且不会撑破窗口边缘'],
  getArchive: async (id: string) => records.find(r => r.id === id),
  updateArchive: async (id: string, patch: any) => { if (state.failSave) throw new Error('fixture_save_failed'); state.writes++; records = records.map(r => r.id === id ? {...r,...patch} : r); return records.find(r => r.id === id); },
  deleteArchive: async (id: string) => {records=records.filter(r=>r.id!==id);},
  folderMemberships: async () => memberships,
  patchFolderMemberships: async (_: any, changes: any[]) => {for (const c of changes) memberships=c.present?[...memberships,c.folderId]:memberships.filter(id=>id!==c.folderId);},
  updateDecision: async (id: string, value: any) => { if (state.failSave) throw new Error('fixture_save_failed'); state.writes++; cards=cards.map(c=>c.id===id?{...c,...value}:c);return cards.find(c=>c.id===id);},
  archiveMarkdown: async () => { if (state.failMarkdown) throw Error('fixture_markdown_failed'); return '# Exported result'; },
  openExternal: async (url: string) => { if (state.failExternal) throw Error('fixture_open_failed'); state.links.push(url); }
}) as any);
const locale = new URLSearchParams(location.search).get('locale') || 'zh-CN';
document.documentElement.lang = locale;
const copy = getCopy(locale);
(window as any).libraryTest.copy = copy;
createRoot(document.getElementById('root')!).render(<ArchiveSurface copy={copy} locale={locale} onClose={() => { document.body.dataset.closed='true'; }} onCapture={async () => records[0]} sites={[]} synthesisSites={[{key:"claude",label:"Claude",host:"claude.ai",url:"https://claude.ai"}] as any} defaultTier="think" preferredId="result-0" pendingSynthesis={null} synthesisCandidate={null} onSendSynthesis={async()=>{}} onCollectSynthesis={async()=>{}} onSaveSynthesis={async()=>records[0]} />);
