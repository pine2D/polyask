import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopDatabase } from '../src/main/database';
import { BackupService } from '../src/main/backup-service';
import { createArchiveRecord } from '../src/shared/archive';

const decision = { kind: 'decision', id: 'd', body: { id: 'd', archiveId: 'a', title: 'Fixture decision', sourceTitle: 'Fixture answer',
  conclusion: 'Keep the saved excerpt', rationale: '', uncertainties: '', nextStep: '', status: 'draft',
  evidence: [{ resultIndex: 0, excerpt: 'Saved excerpt', host: 'chatgpt.com', label: 'ChatGPT', capturedAt: 10 }], createdAt: 10, updatedAt: 20, schema: 2 } };

test('backup preview identifies an unavailable decision source without turning it into a hard restore dependency', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    const service = new BackupService(db, { deviceId: () => 'fixture', now: () => 100 });
    const preview = service.preview({ format: 'polyask-backup', version: 2, exportedAt: 30, entries: [decision] });
    assert.deepEqual(preview.items[0].source, { key: 'archive:a', title: 'Fixture answer', available: false });
    assert.equal(preview.items[0].blocked, undefined);
    assert.equal(preview.items[0].requires, undefined);
    assert.equal(db.outbox.count(), 0, 'advisory preview is read-only');
    assert.deepEqual(service.apply(preview.token, ['decision:d']), { imported: 1, skipped: 0 });
    const restored = db.decisions.get('d')!;
    assert.ok('evidence' in restored);
    assert.equal(restored.evidence[0].excerpt, 'Saved excerpt');
  } finally { db.close(); }
});

test('backup preview marks a source already on this device as available even when the file omits it', () => {
  const db = DesktopDatabase.open(':memory:');
  try {
    db.archives.put(createArchiveRecord({ text: 'Fixture answer', task: 'Fixture answer', results: [] }, { id: 'a', now: 10, deviceId: 'fixture' }), false);
    const service = new BackupService(db, { deviceId: () => 'fixture' });
    const preview = service.preview({ format: 'polyask-backup', version: 2, exportedAt: 30, entries: [decision] });
    assert.equal(preview.items[0].source?.available, true);
  } finally { db.close(); }
});
