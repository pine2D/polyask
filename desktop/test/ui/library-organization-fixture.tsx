import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveOrganizationPanel } from '../../src/renderer/archive-organization-panel';
import type { TaskFolder } from '../../src/shared/task-folder';
import { FolderMembershipDialog } from '../../src/renderer/folder-membership-dialog';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { createArchiveRecord, updateArchiveRecord } from '../../src/shared/archive';
import '../../src/renderer/styles.css';

const locale = new URLSearchParams(location.search).get('locale') || 'en';
const copy = getCopy(locale);
const source = createArchiveRecord({ task: 'Full synthetic result title 😀 — ' + 'Context '.repeat(28), text: 'Synthetic question', createdAt: 100,
  results: [{ host: 'example.test', label: 'Answer', text: 'Synthetic answer.' }] }, { id: 'source', now: 100, deviceId: 'fixture' });
let saves = 0, creates = 0, patches = 0;
const folders: TaskFolder[] = [];
let memberships: string[] = [];
setShellApi({ listFolders: async () => folders, folderMemberships: async () => { await new Promise(resolve => setTimeout(resolve, 120)); return memberships; }, createFolder: async (name: string) => {
  if (++creates === 1) throw new Error('synthetic_creation_failure');
  await new Promise(resolve => setTimeout(resolve, 80));
  const folder: TaskFolder = { id: 'new', name, createdAt: 100, updatedAt: 100, deviceId: 'fixture', schema: 3 };
  folders.push(folder); return folder;
}, patchFolderMemberships: async () => { if (++patches === 1) throw new Error('synthetic_association_failure'); memberships = ['new']; return memberships; } } as any);
const fixture = { copy, source, ready: false, dirty: false,
  inputEvents: [] as { name: string; trusted: boolean; length: number }[],
  keyEvents: [] as { type: string; key: string; trusted: boolean }[],
  get saves() { return saves; }, get creates() { return creates; }, get patches() { return patches; }
};
(window as any).organizationFixture = fixture;
document.addEventListener('input', event => {
  const field = event.target;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
    fixture.inputEvents.push({ name: field.name, trusted: event.isTrusted, length: [...field.value].length });
}, true);
for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => {
  fixture.keyEvents.push({ type, key: (event as KeyboardEvent).key, trusted: event.isTrusted });
}, true);
function App() {
  const [record, setRecord] = useState(source);
  const [organizing, setOrganizing] = useState(false), [open, setOpen] = useState(false), [dirty, setDirty] = useState(false);
  const afterSaved = useRef<(() => void) | null>(null);
  useEffect(() => { fixture.dirty = dirty; }, [dirty]);
  useEffect(() => { fixture.ready = true; }, []);
  return <section className="folder-workspace library" data-focused="true"><div className="folder-columns"><div className="folder-detail">
    <article className="archive-detail"><button id="organize" onClick={() => setOpen(true)}>{copy.libraryOrganize}</button><button id="outside">Next action</button></article>
    <ArchiveOrganizationPanel copy={copy} record={record} busy={false} open={open} onOpenChange={setOpen} onDirtyChange={setDirty}
      onOpenMembership={callback => { afterSaved.current = callback; setOrganizing(true); }} onSave={async patch => {
      if (++saves === 1) return false;
      setRecord(updateArchiveRecord(record, patch, { now: 200, deviceId: 'fixture' })); return true;
    }} />
    {organizing ? <FolderMembershipDialog copy={copy} target={{ kind: 'archive', id: source.id }} {...{ targetTitle: source.task }} folders={folders}
      onCancel={() => setOrganizing(false)} onSaved={() => { setOrganizing(false); afterSaved.current?.(); }} /> : null}
  </div></div></section>;
}
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<App />);
