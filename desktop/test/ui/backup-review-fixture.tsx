import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BackupWorkspace } from '../../src/renderer/backup-workspace';
import { eligibleBackupSelection } from '../../src/renderer/backup-selection';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import type { BackupPreview, BackupPreviewItem } from '../../src/shared/backup';
import '../../src/renderer/styles.css';

const query = new URLSearchParams(location.search), locale = query.get('locale') ?? 'en', count = Number(query.get('count') ?? 20);
document.documentElement.dataset.theme = query.get('theme') ?? 'light';
const copy = getCopy(locale);
const item = (key: string, kind: BackupPreviewItem['kind'], status: BackupPreviewItem['status'], extra: Partial<BackupPreviewItem> = {}): BackupPreviewItem =>
  ({ key, kind, status, id: key.split(':')[1], title: key, local: status === 'new' ? null : { task: 'Local' }, backup: { task: 'Backup' }, ...extra });
const conflicts = Array.from({ length: count }, (_, index) => index % 2 === 0
  ? item(`archive:a${index}`, 'archive', 'conflict', { title: `Saved answer ${index}`, local: { task: 'Unchanged question', favorite: false, note: 'Local note', source: { kind: 'page', capturedAt: 1767225600000, truncated: false } },
    backup: { task: 'Unchanged question', favorite: true, note: 'Backup note', source: { kind: 'page', capturedAt: 1767225660000, truncated: false } } })
  : item(`decision:d${index}`, 'decision', 'conflict', { title: `Decision card ${index}`, local: { title: 'Unchanged card title', status: 'draft', conclusion: 'Local conclusion' },
    backup: { title: 'Unchanged card title', status: 'final', conclusion: 'Backup conclusion', evidence: [{ host: 'chatgpt.com', excerpt: 'Saved evidence', capturedAt: 1767225600000 }] },
    source: { key: `archive:missing${index}`, title: `Original answer ${index}`, available: false } }));
const preview: BackupPreview = { token: 'isolated-review', filename: 'fixture-backup.json', exportedAt: 1767225600000, items: [...conflicts,
  item('archive:deleted', 'archive', 'deleted', { title: 'Deleted saved answer', local: { deletedAt: 1767225600000 } }),
  item('folder:deleted', 'folder', 'deleted', { title: 'Deleted folder', local: { deletedAt: 1767225600000 }, backup: { name: 'Deleted folder' }, note: 'folder_new_identity' }),
  item('folderMembership:link', 'folderMembership', 'new', { title: 'Saved answer folder link', requires: ['folder:deleted', 'archive:a0'], note: 'dependency_required' }),
  item('folderMembership:blocked', 'folderMembership', 'new', { title: 'Unavailable folder link', requires: ['folder:missing'], note: 'dependency_required', blocked: true })
] };
const countSelection = (keys: readonly string[]) => {
  const eligible = [...eligibleBackupSelection(preview.items, new Set(keys))];
  return { imported: eligible.length, skipped: preview.items.length - eligible.length, keys: eligible };
};
(window as any).reviewFixture = { preview, copy, applied: null, countSelection };
setShellApi({ previewBackupSelection: async (_token: string, keys: string[]) => countSelection(keys), applyBackup: async (_token: string, keys: string[]) => {
  (window as any).reviewFixture.applied = keys;
  return countSelection(keys);
} } as any);
function App() {
  const [open, setOpen] = useState(false);
  return <><button id="opener" onClick={() => setOpen(true)}>Review fixture</button>{open ? <BackupWorkspace preview={preview} locale={locale} copy={copy}
    onClose={() => setOpen(false)} onApplied={() => setOpen(false)} /> : null}</>;
}
createRoot(document.getElementById('root')!).render(<App />);
(window as any).reviewReady = new Promise<void>(resolve => {
  const wait = () => document.querySelector('#opener') ? resolve() : setTimeout(wait, 20); wait();
});
