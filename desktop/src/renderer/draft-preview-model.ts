import type { DraftCopy } from '../shared/draft-copy';
import type { DraftKind, StoredDraft } from '../shared/drafts';

export interface DraftPreviewEntry { readonly text: string; readonly label?: string; }
export interface DraftPreviewField { readonly key: string; readonly label: string; readonly entries: readonly DraftPreviewEntry[]; }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const sourceLabel = (copy: DraftCopy, value: unknown, fallback: number): string => copy.draftSourceNumber.replace('{number}',
  String(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 9 ? value + 1 : fallback + 1));

function siteLabel(value: unknown, copy: DraftCopy, fallback: string): string {
  const names: Record<string, string> = {
    claude: 'Claude', 'claude.ai': 'Claude', chatgpt: 'ChatGPT', 'chatgpt.com': 'ChatGPT',
    gemini: 'Gemini', 'gemini.google.com': 'Gemini', deepseek: 'DeepSeek', 'chat.deepseek.com': 'DeepSeek',
    kimi: 'Kimi', 'www.kimi.com': 'Kimi', doubao: copy.draftSiteDoubao, 'www.doubao.com': copy.draftSiteDoubao,
    qianwen: copy.draftSiteQianwen, 'www.qianwen.com': copy.draftSiteQianwen,
    yuanbao: copy.draftSiteYuanbao, 'yuanbao.tencent.com': copy.draftSiteYuanbao,
    chatglm: copy.draftSiteChatglm, 'chatglm.cn': copy.draftSiteChatglm
  };
  return names[text(value)] ?? fallback;
}

/** Preview editing fields only; persistence identities never become user-facing values. */
export function draftPreviewFields(kind: DraftKind, content: unknown, copy: DraftCopy): readonly DraftPreviewField[] {
  const value = record(content), fields: DraftPreviewField[] = [];
  const add = (key: string, label: string, entries: readonly DraftPreviewEntry[]) => {
    fields.push({ key, label, entries: entries.length ? entries : [{ text: copy.draftNotSet }] });
  };
  const scalar = (key: string, label: string) => add(key, label, [{ text: text(value[key]) || copy.draftNotSet }]);
  if (kind === 'prompt') {
    if (typeof content !== 'string' && typeof value.text !== 'string') return [];
    add('text', copy.draftPrompt, [{ text: (typeof content === 'string' ? content : text(value.text)) || copy.draftEmpty }]);
  } else if (kind === 'decision') {
    if (typeof value.title !== 'string') return [];
    scalar('title', copy.draftFieldTitle);
    const statuses: Record<string, string> = { draft: copy.draftStatusDraft, verify: copy.draftStatusVerify, final: copy.draftStatusFinal };
    add('status', copy.draftFieldStatus, [{ text: statuses[text(value.status)] ?? copy.draftUnknownSetting }]);
    scalar('conclusion', copy.draftFieldConclusion); scalar('rationale', copy.draftFieldRationale);
    scalar('uncertainties', copy.draftFieldUncertainties); scalar('nextStep', copy.draftFieldNextStep);
    add('evidence', copy.draftFieldEvidence, array(value.evidence).map((entry, index) => {
      const evidence = record(entry); return { label: sourceLabel(copy, evidence.resultIndex, index), text: text(evidence.excerpt) || copy.draftNotSet };
    }));
  } else if (kind === 'comparison') {
    if (typeof value.judgment !== 'string') return [];
    const labels: Record<string, string> = { conclusion: copy.draftFieldConclusion, evidence: copy.draftFieldNotesEvidence,
      conditions: copy.draftFieldConditions, cost: copy.draftFieldCost };
    const categories = record(value.categories), notes = record(value.notes);
    add('quotes', copy.draftFieldQuotes, array(value.quotes).map((entry, index) => {
      const quote = record(entry), source = sourceLabel(copy, quote.resultIndex, index);
      const classified = array(categories[text(quote.host)]).map(category => labels[text(category)] ?? copy.draftUnknownSetting);
      return { label: [source, siteLabel(quote.host, copy, ''), ...classified].filter(Boolean).join(' · '), text: text(quote.excerpt) || copy.draftNotSet };
    }));
    add('categories', copy.draftFieldCategories, Object.entries(categories).filter(([, selected]) => array(selected).length > 0)
      .map(([host, selected], index) => ({ label: siteLabel(host, copy, sourceLabel(copy, undefined, index)),
        text: array(selected).map(category => labels[text(category)] ?? copy.draftUnknownSetting).join(' · ') })));
    for (const [category, label] of Object.entries(labels)) {
      add(category, label, Object.entries(record(notes[category])).filter(([, note]) => typeof note === 'string' && note.length > 0)
        .map(([host, note], index) => ({ label: siteLabel(host, copy, sourceLabel(copy, undefined, index)), text: text(note) })));
    }
    scalar('judgment', copy.draftFieldJudgment); scalar('nextStep', copy.draftFieldVerification);
  } else if (kind === 'synthesis') {
    if (typeof value.instruction !== 'string') return [];
    add('selectedHosts', copy.draftFieldSources, array(value.selectedHosts).map((host, index) => ({ text: siteLabel(host, copy, sourceLabel(copy, undefined, index)) })));
    add('targetSite', copy.draftFieldTarget, [{ text: siteLabel(value.targetSite, copy, text(value.targetSite) ? copy.draftUnknownSetting : copy.draftNotSet) }]);
    const tiers: Record<string, string> = { think: copy.draftTierThink, fast: copy.draftTierFast };
    add('tier', copy.draftFieldTier, [{ text: value.tier === null ? copy.draftTierFollow : tiers[text(value.tier)] ?? copy.draftUnknownSetting }]);
    scalar('instruction', copy.draftFieldInstruction); scalar('excerpt', copy.draftFieldExcerpt);
  }
  return fields;
}

export function sortDraftCopies(drafts: readonly StoredDraft[]): readonly StoredDraft[] {
  return [...drafts].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}
