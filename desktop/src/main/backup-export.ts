import { setImmediate } from 'node:timers/promises';
import type { BackupDocument, BackupMissingOriginals, BackupOmission, BackupPayload } from '../shared/backup';
import type { DesktopDatabase } from './database';
import type { BackupGuard } from './backup-container';
import { payloadKey, validateContainerManifest } from './backup-container-manifest';
import { projectBody } from './backup-validation';

export async function missingBackupOriginals(database: DesktopDatabase, document: BackupDocument, guard: BackupGuard): Promise<BackupMissingOriginals[]> {
  const missing: BackupMissingOriginals[] = [];
  for (const entry of document.entries.filter(e => e.kind === 'question' && Number(e.body.inputImageCount) > 0)) {
    guard();
    try { database.questionAttachments.readBytes(entry.id); }
    catch {
      let images: BackupOmission['images'] = [];
      try { const metadata = database.questionAttachments.forQuestion(entry.id); if (metadata && !('deletedAt' in metadata)) images = metadata.images; } catch { /* unavailable metadata has no trustworthy names */ }
      missing.push({ questionId: entry.id, title: String(entry.body.text), count: Number(entry.body.inputImageCount), images });
    }
    await setImmediate(); guard();
  }
  return missing;
}
export function backupContainerDocument(database: DesktopDatabase, document: BackupDocument, textOnly: boolean): BackupDocument {
  const entries = [...document.entries], payloads: BackupPayload[] = [], omissions: BackupOmission[] = [];
  for (const parent of document.entries.filter(e => e.kind === 'question' && Number(e.body.inputImageCount) > 0)) {
    let metadata;
    try { metadata = database.questionAttachments.forQuestion(parent.id); } catch { /* text-only can omit unreadable metadata */ }
    if (textOnly) {
      omissions.push({ questionId: parent.id, count: Number(parent.body.inputImageCount), images: metadata && !('deletedAt' in metadata) ? metadata.images : [] });
      continue;
    }
    if (!metadata || 'deletedAt' in metadata) throw new Error('backup_images_missing');
    entries.push({ kind: 'questionAttachments', id: metadata.id, body: projectBody('questionAttachments', metadata, metadata.id) });
    metadata.images.forEach((img, index) => payloads.push({ key: payloadKey(payloads.length), setId: metadata.id, index, size: img.size, sha256: img.sha256 }));
  }
  return validateContainerManifest({ ...document, version: 4, entries, payloads, omissions });
}
