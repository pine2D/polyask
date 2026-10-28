import { markdownTargetKey, type MarkdownDocument, type MarkdownEntry, type MarkdownSelection } from '../shared/markdown-export';
export type MarkdownOrder = 'list' | 'oldest' | 'newest';
export type CheckState = boolean | 'mixed';
export interface MarkdownChoice { readonly selected: readonly string[]; readonly versions: Readonly<Record<string, string>>; readonly synthesisExplicit: boolean }
export type MarkdownChoices = Readonly<Record<string, MarkdownChoice>>;
export interface MarkdownGroup { readonly key: string; readonly site: string; readonly entries: readonly MarkdownEntry[] }
const empty = (): MarkdownChoice => ({ selected: [], versions: {}, synthesisExplicit: false });
export function markdownGroups(doc: MarkdownDocument): MarkdownGroup[] {
  const groups = new Map<string, MarkdownEntry[]>();
  for (const entry of doc.entries) {
    const key = doc.target.kind === 'history' ? entry.site : entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([key, entries]) => ({ key, site: entries[0].site, entries }));
}
export function markdownChosen(group: MarkdownGroup, choice?: MarkdownChoice): MarkdownEntry | undefined {
  return group.entries.find(e => e.available && e.id === choice?.versions[group.key])
    ?? group.entries.filter(e => e.available).sort((a, b) => (b.attempt ?? 0) - (a.attempt ?? 0))[0];
}
export function initialMarkdownSelection(documents: readonly MarkdownDocument[]): MarkdownChoices {
  return Object.fromEntries(documents.map(doc => {
    const entries = markdownGroups(doc).map(g => [g.key, markdownChosen(g)] as const).filter(([, e]) => !!e);
    return [markdownTargetKey(doc.target), { selected: entries.map(([, e]) => e!.id),
      versions: Object.fromEntries(entries.map(([key, e]) => [key, e!.id])), synthesisExplicit: false }];
  }));
}
function updated(doc: MarkdownDocument, choice: MarkdownChoice, selected: readonly string[]): MarkdownChoice {
  const missingAnswer = doc.entries.some(e => e.kind === 'answer' && e.available && !selected.includes(e.id));
  return { ...choice, selected: missingAnswer && !choice.synthesisExplicit
    ? selected.filter(id => doc.entries.find(e => e.id === id)?.kind !== 'synthesis') : selected };
}
export function toggleMarkdownEntry(documents: readonly MarkdownDocument[], selection: MarkdownChoices, key: string, entryId: string): MarkdownChoices {
  const doc = documents.find(d => markdownTargetKey(d.target) === key), choice = selection[key] ?? empty();
  const entry = doc?.entries.find(e => e.id === entryId);
  if (!doc || !entry?.available) return selection;
  const group = markdownGroups(doc).find(g => g.entries.some(e => e.id === entryId))!;
  const checked = choice.selected.includes(entryId);
  const selected = choice.selected.filter(id => !group.entries.some(e => e.id === id));
  if (!checked) selected.push(entryId);
  return { ...selection, [key]: updated(doc, { ...choice, versions: { ...choice.versions, [group.key]: entryId },
    synthesisExplicit: entry.kind === 'synthesis' ? !checked : choice.synthesisExplicit }, selected) };
}
export function chooseMarkdownVersion(documents: readonly MarkdownDocument[], selection: MarkdownChoices, key: string, entryId: string): MarkdownChoices {
  if (selection[key]?.selected.includes(entryId)) return selection;
  return toggleMarkdownEntry(documents, selection, key, entryId);
}
export function markdownSelectionState(documents: readonly MarkdownDocument[], selection: MarkdownChoices, site?: string): CheckState {
  let total = 0, selected = 0;
  for (const doc of documents) for (const group of markdownGroups(doc)) {
    if ((site !== undefined && group.site !== site) || !group.entries.some(e => e.available)) continue;
    total++;
    if (group.entries.some(e => selection[markdownTargetKey(doc.target)]?.selected.includes(e.id))) selected++;
  }
  return selected === 0 ? false : selected === total ? true : 'mixed';
}
export function selectMarkdownDocuments(documents: readonly MarkdownDocument[], selection: MarkdownChoices, checked: boolean): MarkdownChoices {
  const next = { ...selection };
  for (const doc of documents) {
    const key = markdownTargetKey(doc.target), choice = selection[key] ?? empty();
    next[key] = { ...choice, selected: checked ? markdownGroups(doc).flatMap(g => { const e = markdownChosen(g, choice); return e ? [e.id] : []; }) : [], synthesisExplicit: false };
  }
  return next;
}
export function toggleMarkdownSite(documents: readonly MarkdownDocument[], selection: MarkdownChoices, site: string): MarkdownChoices {
  const checked = markdownSelectionState(documents, selection, site) !== true, next = { ...selection };
  for (const doc of documents) {
    const key = markdownTargetKey(doc.target), choice = selection[key] ?? empty(), selected = new Set(choice.selected);
    for (const group of markdownGroups(doc).filter(g => g.site === site)) {
      if (checked) { const entry = markdownChosen(group, choice); if (entry) selected.add(entry.id); }
      else for (const entry of group.entries) selected.delete(entry.id);
    }
    next[key] = updated(doc, choice, [...selected]);
  }
  return next;
}
export function orderMarkdownDocuments(documents: readonly MarkdownDocument[], order: MarkdownOrder): MarkdownDocument[] {
  return order === 'list' ? [...documents] : [...documents].sort((a, b) => order === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
}
export function markdownSelectionRequest(documents: readonly MarkdownDocument[], selection: MarkdownChoices, order: MarkdownOrder = 'list'): MarkdownSelection[] {
  return orderMarkdownDocuments(documents, order).flatMap(doc => {
    const choice = selection[markdownTargetKey(doc.target)], entryIds = markdownGroups(doc).flatMap(g => g.entries
      .filter(e => e.available && choice?.selected.includes(e.id)).map(e => e.id));
    return entryIds.length ? [{ target: doc.target, revision: doc.revision, entryIds }] : [];
  });
}
export function refreshMarkdownSelection(previous: readonly MarkdownDocument[], documents: readonly MarkdownDocument[], selection: MarkdownChoices): MarkdownChoices {
  return Object.fromEntries(documents.map(doc => {
    const key = markdownTargetKey(doc.target), old = previous.find(d => markdownTargetKey(d.target) === key), choice = selection[key] ?? empty();
    if (!old || old.revision !== doc.revision) return [key, empty()];
    const valid = new Set(doc.entries.filter(e => e.available).map(e => e.id));
    return [key, updated(doc, { ...choice, versions: Object.fromEntries(Object.entries(choice.versions).filter(([, id]) => valid.has(id))) }, choice.selected.filter(id => valid.has(id)))];
  }));
}
