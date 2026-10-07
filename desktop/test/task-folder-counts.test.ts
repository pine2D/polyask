import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { createLocalDataServices } from '../src/main/local-data-services';
import { folderMembershipId, type FolderTarget } from '../src/shared/task-folder';

test('folder list counts only live linked originals and cards without changing stored folder bodies or outbox', () => {
  const db = DesktopDatabase.open(':memory:'); const services = createLocalDataServices(db);
  try {
    const folder = services.folders.create('A'), empty = services.folders.create('Empty');
    const original = services.archives.add({ text: 'Synthetic', task: 'Synthetic', results: [{ host: 'claude.ai', label: 'Claude', text: 'Short body' }] });
    const card = services.decisions.create({ archiveId: original.id, title: 'Card', conclusion: '', rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [] });
    const link = (target: FolderTarget) => services.folders.patchMemberships(target, [{ folderId: folder.id, present: true }]);
    link({ kind: 'archive', id: original.id }); link({ kind: 'decision', id: card.id });
    const before = db.outbox.count();
    const listed = services.folders.list() as Array<{ id: string; contentCount?: number }>;
    assert.equal(listed.find(item => item.id === folder.id)?.contentCount, 2);
    assert.equal(listed.find(item => item.id === empty.id)?.contentCount, 0);
    assert.equal('contentCount' in db.folders.get(folder.id)!, false); assert.equal(db.outbox.count(), before);
    services.archives.delete(original.id);
    assert.equal((services.folders.list() as any[]).find(item => item.id === folder.id)?.contentCount, 1);
    services.folders.patchMemberships({ kind: 'decision', id: card.id }, [{ folderId: folder.id, present: false }]);
    assert.equal((services.folders.list() as any[]).find(item => item.id === folder.id)?.contentCount, 0);
  } finally { db.close(); }
});
test('counts ignore dangling memberships from sync and return zero for an empty live folder', () => {
  const db = DesktopDatabase.open(':memory:'); const services = createLocalDataServices(db);
  try {
    const folder = services.folders.create('A'), target = { kind: 'archive', id: 'missing' } as const;
    db.folders.putMembership({ id: folderMembershipId(target, folder.id), folderId: folder.id, targetKind: target.kind,
      targetId: target.id, schema: 3, createdAt: 1, updatedAt: 1, deviceId: 'local' }, false);
    assert.equal((services.folders.list()[0] as any).contentCount, 0);
    services.folders.delete(folder.id); assert.equal(services.folders.list().length, 0);
  } finally { db.close(); }
});
