import { useLayoutEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { resolveLocale } from '../shared/locale';
import { ipcErrorCode } from '../shared/ipc-error';
import { MAX_MARKDOWN_RECORDS, type MarkdownDocument, type MarkdownExportResult, type MarkdownTarget } from '../shared/markdown-export';
import { shell } from './shell-api';
import { MarkdownExportPanel } from './markdown-export-panel';
import { initialMarkdownSelection, toggleMarkdownSite, toggleMarkdownEntry, chooseMarkdownVersion, selectMarkdownDocuments,
  refreshMarkdownSelection, markdownSelectionRequest, type MarkdownChoices, type MarkdownOrder } from './markdown-export-model';
export function markdownExportMessage(copy: DesktopCopy, code: string): string {
  const messages: Record<string, string> = { markdown_not_found: copy.markdownNotFound, markdown_source_changed: copy.markdownSourceChanged,
    markdown_busy: copy.markdownBusy, markdown_too_many: copy.markdownTooMany, markdown_too_large: copy.markdownTooLarge,
    markdown_empty: copy.markdownEmpty, markdown_failed: copy.markdownFailed };
  return messages[code] ?? copy.markdownFailed;
}
export function useMarkdownExport(options: { copy: DesktopCopy; locale: string; enabled?: boolean; onBlocking?: (busy: boolean) => void; onStatus?: (message: string) => void }) {
  const current = useRef(options); current.current = options;
  const mounted = useRef(false), epoch = useRef(0), pending = useRef(false), visible = useRef(false), savingRef = useRef(false);
  const targets = useRef<readonly MarkdownTarget[]>([]);
  const [active, setActive] = useState(false), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState<readonly MarkdownDocument[]>([]), [selection, setSelection] = useState<MarkdownChoices>({});
  const [order, setOrder] = useState<MarkdownOrder>('list'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const locale = () => { const raw = current.current.locale; return raw === 'zhCN' || raw === 'zhTW' ? raw : resolveLocale(raw); };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; current.current.onBlocking?.(false); }; }, []);
  useLayoutEffect(() => { current.current.onBlocking?.(active || saving); }, [active, saving]);
  useLayoutEffect(() => {
    if (options.enabled !== false) return;
    epoch.current++; pending.current = visible.current = savingRef.current = false;
    setActive(false); setLoading(false); setSaving(false);
  }, [options.enabled]);
  const valid = (ticket: number) => mounted.current && ticket === epoch.current;
  const close = () => {
    if (savingRef.current) return;
    epoch.current++; pending.current = false; visible.current = false; setActive(false); setLoading(false);
  };
  const load = async (refresh: boolean) => {
    if (pending.current) return;
    pending.current = true; const ticket = ++epoch.current;
    setLoading(true); setError(''); setNotice('');
    try {
      const next = targets.current.length ? await shell.previewMarkdown({ targets: targets.current, locale: locale(), allowMissing: refresh }) : [];
      if (!valid(ticket)) return;
      setSelection(previous => refresh ? refreshMarkdownSelection(documents, next, previous) : initialMarkdownSelection(next));
      setDocuments(next); setStale(false);
      if (refresh) {
        const removed = targets.current.length - next.length;
        targets.current = next.map(doc => doc.target);
        setNotice(removed ? formatCopy(current.current.copy.markdownRemoved, { count: removed }) : current.current.copy.markdownRefreshed);
      }
    } catch (cause) { if (valid(ticket)) { setError(markdownExportMessage(current.current.copy, ipcErrorCode(cause))); setStale(true); } }
    finally { if (valid(ticket)) { pending.current = false; setLoading(false); } }
  };
  const open = (next: readonly MarkdownTarget[]) => {
    if (pending.current || visible.current || !mounted.current) return;
    if (!next.length || next.length > MAX_MARKDOWN_RECORDS) { current.current.onStatus?.(next.length ? options.copy.markdownTooMany : options.copy.markdownEmpty); return; }
    targets.current = next; visible.current = true; setActive(true); setDocuments([]); setSelection({}); setOrder('list'); setStale(false);
    void load(false);
  };
  const finish = (result: MarkdownExportResult) => {
    const copy = current.current.copy;
    if (result.status === 'saved') {
      visible.current = false; setActive(false); current.current.onStatus?.(copy.markdownSaved);
    } else if (result.status === 'cancelled') {
      if (visible.current) setNotice(copy.markdownCancelled); else current.current.onStatus?.(copy.markdownCancelled);
    } else {
      const message = markdownExportMessage(copy, result.code);
      if (visible.current) { setError(message); setStale(result.code === 'markdown_source_changed' || result.code === 'markdown_not_found'); }
      else current.current.onStatus?.(message);
    }
  };
  const save = async () => {
    const selections = markdownSelectionRequest(documents, selection, order);
    if (pending.current || stale || !selections.length) return;
    pending.current = savingRef.current = true; const ticket = ++epoch.current;
    setSaving(true); setError(''); setNotice('');
    try { const result = await shell.exportMarkdown({ selections, locale: locale() }); if (valid(ticket)) finish(result); }
    catch { if (valid(ticket)) finish({ status: 'failed', code: 'markdown_failed' }); }
    finally { if (valid(ticket)) { pending.current = savingRef.current = false; setSaving(false); } }
  };
  const single = async (target: MarkdownTarget, entryId: string, expectedVersion?: Pick<MarkdownDocument, 'updatedAt' | 'deviceId'>) => {
    if (pending.current || visible.current || !mounted.current) return;
    pending.current = savingRef.current = true; const ticket = ++epoch.current; setSaving(true);
    current.current.onStatus?.(current.current.copy.markdownSaving);
    try {
      const [doc] = await shell.previewMarkdown({ targets: [target], locale: locale() });
      if (!valid(ticket)) return;
      if (expectedVersion && (doc.updatedAt !== expectedVersion.updatedAt || doc.deviceId !== expectedVersion.deviceId)) throw new Error('markdown_source_changed');
      if (!doc.entries.some(e => e.id === entryId && e.available)) throw new Error('markdown_not_found');
      const result = await shell.exportMarkdown({ selections: [{ target, revision: doc.revision, entryIds: [entryId] }], locale: locale() });
      if (valid(ticket)) finish(result);
    } catch (cause) { if (valid(ticket)) current.current.onStatus?.(markdownExportMessage(current.current.copy, ipcErrorCode(cause))); }
    finally { if (valid(ticket)) { pending.current = savingRef.current = false; setSaving(false); } }
  };
  return { open, single, active, busy: loading || saving, panel: active ? <MarkdownExportPanel documents={documents} selection={selection} copy={options.copy} locale={locale() === 'zhCN' ? 'zh-CN' : locale() === 'zhTW' ? 'zh-TW' : 'en'}
    order={order} loading={loading} saving={saving} stale={stale} error={error} notice={notice} onCancel={close} onSave={() => { void save(); }} onRefresh={() => { void load(true); }}
    onSite={site => setSelection(s => toggleMarkdownSite(documents, s, site))} onAll={(docs, checked) => setSelection(s => selectMarkdownDocuments(docs, s, checked))}
    onToggle={(key, id) => setSelection(s => toggleMarkdownEntry(documents, s, key, id))} onVersion={(key, id) => setSelection(s => chooseMarkdownVersion(documents, s, key, id))} onOrder={setOrder} /> : null };
}
