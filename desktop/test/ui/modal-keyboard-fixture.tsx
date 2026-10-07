import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderModal } from '../../src/renderer/folder-modal';
import { BackupWorkspace } from '../../src/renderer/backup-workspace';
import { LibraryMenu } from '../../src/renderer/library-menu';
import { LibrarySelect } from '../../src/renderer/library-select';
import { ImagePicker } from '../../src/renderer/image-picker';
import { getCopy } from '../../src/shared/copy';
import type { BackupPreview } from '../../src/shared/backup';
import { setShellApi } from '../../src/renderer/shell-api';
import '../../src/renderer/styles.css';

const kind = new URLSearchParams(location.search).get('kind');
setShellApi({ previewBackupSelection: async () => ({ imported: 1, skipped: 0, keys: ['folder:f1'] }) } as any);
const copy = getCopy('en');
const preview: BackupPreview = { token: 'fixture', exportedAt: 1000, items: [
  { key: 'folder:f1', id: 'f1', kind: 'folder', status: 'new', title: 'Fixture folder', local: null, backup: { name: 'Fixture folder' } }
] };

function App() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('draft');
  return <><button id="opener" onClick={() => setOpen(true)}>Open fixture</button>
    {kind === 'images' ? <ImagePicker copy={copy} images={[{ name: 'fixture.png', type: 'image/png', size: 1, dataUrl: 'data:image/png;base64,AA==' }]}
      open={open} disabled={false} warning={null} warningCount={0} error={null} onOpenChange={setOpen}
      onFiles={() => {}} onRemove={() => {}} onAdjustScope={() => {}} /> : open ?
      kind === 'menu' ? <LibraryMenu label="Actions" actions={[{ label: 'Keep record', run: () => {} }]} /> :
      kind === 'select' ? <><LibrarySelect label="Status" searchLabel="Find status" value={value}
        options={[{ value: 'draft', label: 'Draft' }, { value: 'final', label: 'Final' }]} onChange={setValue} /><output>{value}</output></> :
      kind === 'folder' ? <FolderModal copy={copy} title="Fixture folder" busy={false} onCancel={() => setOpen(false)}>
      <input id="name" aria-label="Folder name" defaultValue="Keep this draft" />
      <button disabled>Disabled</button><button hidden>Hidden</button><div inert><button>Inert</button></div>
      <details><summary id="summary">Extra fields</summary><button>Collapsed action</button></details>
      <a id="source" href="https://example.com/source">Source</a><textarea id="note" aria-label="Note" />
    </FolderModal> : <BackupWorkspace preview={preview} copy={copy} locale="en" onClose={() => setOpen(false)} onApplied={() => setOpen(false)} /> : null}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
(window as any).modalReady = new Promise<void>(resolve => {
  const wait = () => document.querySelector('#opener') ? resolve() : setTimeout(wait, 20); wait();
});
