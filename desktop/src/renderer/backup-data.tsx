import { formatCopy, type DesktopCopy } from '../shared/copy';
import { formatDateTime } from '../shared/format';

const OMIT = new Set(['id', 'schema', 'textHash', 'searchText', 'resultPreviews', 'preview']);
const FIELD_KEYS: Record<string, keyof DesktopCopy> = {
  questionId: 'backupFieldId', site: 'backupFieldSite', attempt: 'backupFieldIndex', submission: 'decisionStatus', capture: 'decisionStatus', submissionCode: 'backupFieldCode', captureCode: 'backupFieldCode', answerMarkdown: 'backupFieldAnswers', conversationUrl: 'backupFieldUrl', requestedTier: 'backupFieldTier', sealedAt: 'backupFieldTime',
  task: 'archiveQuestion', text: 'backupFieldValue', title: 'decisionName', name: 'decisionName', conclusion: 'decisionConclusion', rationale: 'decisionRationale', uncertainties: 'decisionUncertainties', nextStep: 'decisionNextStep', evidence: 'decisionEvidence', status: 'decisionStatus', note: 'archiveNote', tags: 'archiveTags',
  results: 'backupFieldAnswers', source: 'backupFieldSource', host: 'backupFieldSite', label: 'decisionName', excerpt: 'backupFieldExcerpt', sites: 'backupFieldSites', selectedSites: 'backupFieldSites', tier: 'backupFieldTier', synthesis: 'backupFieldSynthesis', instruction: 'backupFieldInstruction', capturedAt: 'backupFieldTime', createdAt: 'backupFieldTime', updatedAt: 'backupFieldTime', lastUsedAt: 'backupFieldTime', ts: 'backupFieldTime', deletedAt: 'backupFieldDeletedAt', url: 'backupFieldUrl', kind: 'backupFieldKind', targetKind: 'backupFieldKind', code: 'backupFieldCode', state: 'decisionStatus', truncated: 'backupFieldTruncated', resultIndex: 'backupFieldIndex', favorite: 'backupFieldFavorite', folderId: 'backupFieldFolder', targetId: 'backupFieldTarget', archiveId: 'decisionSource', sourceTitle: 'decisionSource', hosts: 'backupFieldSites', winnerHost: 'archiveBestAnswer'
};
const KIND_KEYS: Record<string, keyof DesktopCopy> = { question: 'backupKindQuestion', questionAnswer: 'backupKindQuestionAnswer', history: 'backupKindHistory', archive: 'backupKindArchive', decision: 'backupKindDecision', folder: 'backupKindFolder', folderMembership: 'backupKindMembership', template: 'backupKindTemplate', group: 'backupKindGroup', workspace: 'backupKindWorkspace', page: 'backupSourcePage', selection: 'backupSourceSelection' };
const SITE_NAMES: Record<string, string> = { claude: 'Claude', 'claude.ai': 'Claude', chatgpt: 'ChatGPT', 'chatgpt.com': 'ChatGPT', gemini: 'Gemini', 'gemini.google.com': 'Gemini', deepseek: 'DeepSeek', 'chat.deepseek.com': 'DeepSeek', kimi: 'Kimi', 'www.kimi.com': 'Kimi' };
const SITE_KEYS: Record<string, keyof DesktopCopy> = { doubao: 'backupSiteDoubao', 'www.doubao.com': 'backupSiteDoubao', qianwen: 'backupSiteQianwen', 'www.qianwen.com': 'backupSiteQianwen', yuanbao: 'backupSiteYuanbao', 'yuanbao.tencent.com': 'backupSiteYuanbao', chatglm: 'backupSiteChatglm', 'chatglm.cn': 'backupSiteChatglm' };
const TIMES = new Set(['capturedAt', 'createdAt', 'updatedAt', 'lastUsedAt', 'sealedAt', 'deletedAt', 'ts']);

export function backupKind(copy: DesktopCopy, kind: string): string { return copy[KIND_KEYS[kind] ?? 'backupDetails']; }

export function formatBackupValue(value: unknown, field: string, copy: DesktopCopy, locale: string): string {
  if (value === null || value === undefined) return ['tier', 'requestedTier', 'state'].includes(field) ? copy.followSite : copy.backupNotSet;
  if (typeof value === 'boolean') return value ? copy.backupYes : copy.backupNo;
  if (typeof value === 'number' && TIMES.has(field) && Number.isSafeInteger(value) && value >= 0) {
    try { return formatDateTime(value, locale); } catch { return String(value); }
  }
  const text = String(value);
  if (['site', 'host', 'hosts', 'sites', 'selectedSites', 'winnerHost'].includes(field)) return SITE_NAMES[text] ?? (SITE_KEYS[text] ? copy[SITE_KEYS[text]] : text);
  let enums: Record<string, keyof DesktopCopy> | undefined;
  if (field === 'status') enums = { draft: 'decisionDraft', verify: 'decisionVerify', final: 'decisionFinal' };
  else if (['tier', 'requestedTier'].includes(field)) enums = { think: 'think', fast: 'fast' };
  else if (field === 'submission') enums = { pending: 'sending', submitted: 'submitted', failed: 'questionSubmissionFailed', unconfirmed: 'questionSubmissionUnconfirmed', cancelled: 'questionSubmissionCancelled' };
  else if (field === 'capture') enums = { waiting: 'questionStateWaiting', partial: 'questionStatePartial', complete: 'questionStateComplete', unknown: 'questionStateUnknown', unavailable: 'questionStateUnavailable', interrupted: 'questionStateInterrupted' };
  else if (field === 'state') enums = { think: 'think', fast: 'fast', complete: 'answerComplete', submitted: 'submitted', generating: 'generating', failed: 'failed', cancelled: 'cancelledStatus', ready: 'ready', loading: 'loading', ok: 'answerComplete', error: 'failed' };
  else if (['kind', 'targetKind'].includes(field)) enums = KIND_KEYS;
  return enums ? enums[text] ? copy[enums[text]] : formatCopy(copy.backupUnknownValue, { value: text }) : text;
}

export function businessBackupData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(businessBackupData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !OMIT.has(key)).map(([key, child]) => [key, businessBackupData(child)]));
  return value;
}

export function changedBackupFields(local: unknown, backup: Readonly<Record<string, unknown>>): Set<string> {
  const before = (local && typeof local === 'object' ? businessBackupData(local) : {}) as Record<string, unknown>;
  const after = businessBackupData(backup) as Record<string, unknown>;
  return new Set([...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])));
}

export function BusinessData({ value, copy, locale, field = '', changed, fields }: {
  value: unknown; copy: DesktopCopy; locale: string; field?: string; changed?: ReadonlySet<string>; fields?: ReadonlySet<string>;
}): React.JSX.Element {
  if (!value || typeof value !== 'object') return <p className="backup-value">{formatBackupValue(value, field, copy, locale)}</p>;
  if (Array.isArray(value)) return <ol className="backup-values">{value.map((child, index) => <li key={index}><BusinessData value={child} copy={copy} locale={locale} field={field} /></li>)}</ol>;
  return <dl className="backup-data">{Object.entries(value).filter(([key]) => !OMIT.has(key) && (!fields || fields.has(key))).map(([key, child]) => <div key={key} data-changed={changed?.has(key) || undefined}>
    <dt>{FIELD_KEYS[key] ? copy[FIELD_KEYS[key]] : `${copy.backupDetails} · ${key}`}</dt><dd><BusinessData value={child} copy={copy} locale={locale} field={key} /></dd>
  </div>)}</dl>;
}
