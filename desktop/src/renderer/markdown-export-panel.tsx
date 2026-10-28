import { formatCopy, type DesktopCopy } from '../shared/copy';
import { markdownTargetKey, type MarkdownDocument } from '../shared/markdown-export';
import { FolderModal } from './folder-modal';
import { MarkdownExportRecord } from './markdown-export-record';
import { markdownSelectionRequest, markdownSelectionState, orderMarkdownDocuments, type MarkdownChoices, type MarkdownOrder } from './markdown-export-model';
export function MarkdownExportPanel({ documents, selection, copy, order, loading, saving, stale, error, notice, onCancel, onSave, onRefresh, onSite, onAll, onToggle, onVersion, onOrder }: {
  documents: readonly MarkdownDocument[]; selection: MarkdownChoices; copy: DesktopCopy; order: MarkdownOrder;
  loading: boolean; saving: boolean; stale: boolean; error: string; notice: string; onCancel: () => void; onSave: () => void; onRefresh: () => void;
  onSite: (site: string) => void; onAll: (documents: readonly MarkdownDocument[], checked: boolean) => void;
  onToggle: (key: string, id: string) => void; onVersion: (key: string, id: string) => void; onOrder: (order: MarkdownOrder) => void;
}) {
  const selected = markdownSelectionRequest(documents, selection), disabled = loading || saving;
  const entries = documents.flatMap(d => d.entries.filter(e => selection[markdownTargetKey(d.target)]?.selected.includes(e.id)));
  const answers = entries.filter(e => e.kind === 'answer'), decisions = entries.filter(e => e.kind === 'decision');
  const incomplete = answers.filter(e => ['partial', 'interrupted', 'waiting'].includes(e.state) || e.truncated).length;
  const sites = [...new Map(documents.flatMap(d => d.entries.filter(e => e.kind === 'answer' && e.available).map(e => [e.site, e.label] as const))).entries()];
  return <FolderModal copy={copy} title={copy.markdownTitle} busy={saving} onCancel={onCancel} className="markdown-export-panel">
    <div className="markdown-export-scroll" aria-busy={loading}>
      <p>{copy.markdownChoose}</p>
      <div className="markdown-export-sites" role="group" aria-label={copy.sitesCompact}>
        {sites.map(([site, label]) => <button type="button" key={site} disabled={disabled} aria-pressed={markdownSelectionState(documents, selection, site)} onClick={() => onSite(site)}>{label}</button>)}
      </div>
      <div className="markdown-export-options">
        <div><button type="button" disabled={disabled || !documents.length} onClick={() => onAll(documents, true)}>{copy.markdownAll}</button>
          <button type="button" disabled={disabled || !selected.length} onClick={() => onAll(documents, false)}>{copy.markdownClear}</button></div>
        <label>{copy.markdownOrder}<select value={order} disabled={disabled} onChange={e => onOrder(e.target.value as MarkdownOrder)}>
          <option value="list">{copy.markdownListOrder}</option><option value="oldest">{copy.markdownOldest}</option><option value="newest">{copy.markdownNewest}</option>
        </select></label>
      </div>
      {loading ? <p role="status">{copy.markdownLoading}</p> : orderMarkdownDocuments(documents, order).map(doc => <MarkdownExportRecord key={markdownTargetKey(doc.target)} document={doc} selection={selection}
        copy={copy} disabled={saving} onToggle={onToggle} onVersion={onVersion} onAll={(d, checked) => onAll([d], checked)} />)}
      {incomplete > 0 && <p className="markdown-export-warning" role="note">{formatCopy(copy.markdownIncomplete, { count: incomplete })}</p>}
      <p className="markdown-export-scope">{copy.markdownScope}</p>
    </div>
    <footer className="markdown-export-footer">
      <div role="status" aria-live="polite"><strong>{formatCopy(copy.markdownCount, { records: selected.length, answers: answers.length })}</strong>
        {decisions.length > 0 && <span> · {formatCopy(copy.markdownDecisions, { count: decisions.length })}</span>}
        <p>{copy.markdownLimit}</p>{notice && <p>{notice}</p>}
      </div>
      {error && <p role="alert" className="markdown-export-error">{error}</p>}
      {!loading && !selected.length && <p>{copy.markdownEmpty}</p>}
      <div className="confirm-actions"><button type="button" disabled={disabled} onClick={onRefresh}>{copy.markdownRefresh}</button>
        <button type="button" className="primary" disabled={disabled || stale || !selected.length} onClick={onSave}>{saving ? copy.markdownSaving : copy.markdownSaveOne}</button></div>
    </footer>
  </FolderModal>;
}
