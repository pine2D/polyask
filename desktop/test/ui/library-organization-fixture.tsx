import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArchiveMetadata } from '../../src/renderer/archive-metadata';
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
setShellApi({ folderMemberships: async () => { await new Promise(resolve => setTimeout(resolve, 120)); return []; }, createFolder: async (name: string) => {
  if (++creates === 1) throw new Error('synthetic_creation_failure');
  await new Promise(resolve => setTimeout(resolve, 80));
  return { id: 'new', name, createdAt: 100, updatedAt: 100, deviceId: 'fixture', schema: 3 };
}, patchFolderMemberships: async () => { if (++patches === 1) throw new Error('synthetic_association_failure'); return ['new']; } } as any);
const fixture = { copy, source, ready: false,
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
  const [organizing, setOrganizing] = useState(false);
  useEffect(() => { fixture.ready = true; }, []);
  return <section className="folder-workspace library" data-focused="true"><div className="folder-columns"><div className="folder-detail">
    <article className="archive-detail"><ArchiveMetadata copy={copy} record={record} busy={false} onSave={async patch => {
      if (++saves === 1) return false;
      setRecord(updateArchiveRecord(record, patch, { now: 200, deviceId: 'fixture' })); return true;
    }} /><button id="organize" onClick={() => setOrganizing(true)}>{copy.folderMembership}</button></article>
    {organizing ? <FolderMembershipDialog copy={copy} target={{ kind: 'archive', id: source.id }} {...{ targetTitle: source.task }} folders={[]}
      onCancel={() => setOrganizing(false)} onSaved={() => setOrganizing(false)} /> : null}
  </div></div></section>;
}
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<App />);
