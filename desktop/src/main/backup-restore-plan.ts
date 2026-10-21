import { questionAttachmentId } from './question-attachment-repository';
import { createHash } from 'node:crypto';
import type { BackupEntry, BackupKind, BackupSelectionPreview } from '../shared/backup';
import { folderMembershipId } from '../shared/task-folder';
import { questionAnswerId } from './question-repository';
import { comparison, inheritBackupParticipation, projectBody } from './backup-validation';

type Body = Record<string, any>;
export const backupEntryKey = (entry: Pick<BackupEntry, 'kind' | 'id'>) => `${entry.kind}:${entry.id}`;
export const activeBackupBody = (body: Body | null | undefined) => !!body && !('deletedAt' in body);
export const restoredBackupId = (id: string, seed: unknown) => `restore-${createHash('sha256').update(JSON.stringify([id, seed])).digest('hex').slice(0, 40)}`;
/** Imported drafts remain distinct branches from this device's autosaved form. */
export const restoredDraftId = (entry: BackupEntry) => restoredBackupId(entry.id, ['draft', comparison(entry.body)]);

export function questionRestoreSeed(id: string, entries: readonly BackupEntry[], snapshot: ReadonlyMap<string, Body>): unknown {
  const parent = snapshot.get(`question:${id}`);
  const attachments = entries.find(e => e.kind === 'questionAttachments' && e.body.questionId === id);
  if (attachments) {
    // Fixed identity for this immutable parent: selection and later tombstones cannot mint another copy.
    const seed = ['question-originals', id, attachments.body.createdAt];
    const mapped = snapshot.get(`question:${restoredBackupId(id, seed)}`);
    const deletedChild = entries.some(e => (e.kind === 'questionAnswer' || e.kind === 'questionAttachments') && e.body.questionId === id &&
      snapshot.has(backupEntryKey(e)) && !activeBackupBody(snapshot.get(backupEntryKey(e))));
    return mapped || (parent && !activeBackupBody(parent)) || deletedChild ? seed : null;
  }
  if (parent && !activeBackupBody(parent)) return parent.deletedAt;
  const deleted = entries.filter(entry => entry.kind === 'questionAnswer' && entry.body.questionId === id)
    .map(entry => snapshot.get(backupEntryKey(entry))).filter(body => body && !activeBackupBody(body));
  return deleted.length ? deleted.map(body => [body!.id, body!.deletedAt]).sort().flat() : null;
}

/** Plan against a private snapshot; preview and apply share every restore/skip decision. */
export function planBackupRestore(entries: readonly BackupEntry[], source: ReadonlyMap<string, Body>, selected: ReadonlySet<string>,
  options: { readonly now: () => number; readonly sealAt: number; readonly deviceId: () => string; readonly attachmentsAvailable?: (questionId: string) => boolean }) {
  const snapshot = new Map(source), folderMap = new Map<string, string>(), questionMap = new Map<string, string>();
  const writes: Array<{ kind: BackupKind; id: string; body: Body; key: string }> = [];
  const ordered = [...entries].sort((a, b) => Number(a.kind === 'folderMembership' || a.kind === 'questionAnswer' || a.kind === 'questionAttachments') - Number(b.kind === 'folderMembership' || b.kind === 'questionAnswer' || b.kind === 'questionAttachments'));
  const chosen = ordered.filter(entry => selected.has(backupEntryKey(entry)));
  for (const entry of ordered) {
    const key = backupEntryKey(entry);
    if (!selected.has(key)) continue;
    const original = snapshot.get(key);
    let body = { ...entry.body } as Body;
    if (entry.kind === 'draft') {
      body.id = restoredDraftId(entry);
      // Re-imports keep later edits, and a deleted restored copy is terminal.
      if (snapshot.has(`draft:${body.id}`)) continue;
      if (activeBackupBody(original) && JSON.stringify(comparison(projectBody('draft', original))) === JSON.stringify(comparison(entry.body))) continue;
    }
    if (entry.kind === 'folder' && original && !activeBackupBody(original)) {
      body.id = restoredBackupId(entry.id, original.deletedAt);
      folderMap.set(entry.id, body.id);
      if (snapshot.has(`folder:${body.id}`)) continue;
    }
    const seed = entry.kind === 'question' ? questionRestoreSeed(entry.id, entries.some(e => e.kind === 'questionAttachments' && e.body.questionId === entry.id) ? entries : chosen, snapshot) : null;
    if (entry.kind === 'question' && seed !== null) {
      body.id = restoredBackupId(entry.id, seed);
      questionMap.set(entry.id, body.id);
      if (snapshot.has(`question:${body.id}`)) continue;
    }
    if (entry.kind === 'questionAttachments') {
      const seed = questionRestoreSeed(String(entry.body.questionId), entries, source);
      if (seed !== null && !questionMap.has(body.questionId)) continue;
      body.questionId = questionMap.get(body.questionId) ?? body.questionId;
      body.id = questionAttachmentId(body.questionId);
      const parent = snapshot.get(`question:${body.questionId}`), target = snapshot.get(`questionAttachments:${body.id}`);
      if (!activeBackupBody(parent) || parent!.inputImageCount !== body.images.length || parent!.createdAt !== body.createdAt ||
        (target && !activeBackupBody(target))) continue;
    }
    if (entry.kind === 'questionAnswer') {
      const hasOriginals = entries.some(e => e.kind === 'questionAttachments' && e.body.questionId === body.questionId);
      if (hasOriginals && questionRestoreSeed(body.questionId, entries, source) !== null && !questionMap.has(body.questionId)) continue;
      body.questionId = questionMap.get(body.questionId) ?? body.questionId;
      body.id = questionAnswerId(body.questionId, body.site, body.attempt);
      if (!activeBackupBody(snapshot.get(`question:${body.questionId}`))) continue;
      const target = snapshot.get(`questionAnswer:${body.id}`);
      if (target && !activeBackupBody(target)) continue;
      // Keep reviewed business content stable; only version stamps use the live apply clock.
      if (body.sealedAt === null) { body.capture = 'interrupted'; body.sealedAt = Math.max(options.sealAt, body.createdAt); }
    }
    if (entry.kind === 'folderMembership') {
      body.folderId = folderMap.get(body.folderId) ?? body.folderId;
      body.id = folderMembershipId({ kind: body.targetKind, id: body.targetId }, body.folderId);
      if (!activeBackupBody(snapshot.get(`folder:${body.folderId}`)) || !activeBackupBody(snapshot.get(`${body.targetKind}:${body.targetId}`))) continue;
    }
    const id = String(body.id ?? entry.id), current = snapshot.get(`${entry.kind}:${id}`);
    if (entry.kind === 'workspace') body = inheritBackupParticipation(body, current);
    if (activeBackupBody(current) && JSON.stringify(comparison(projectBody(entry.kind, current, entry.id))) === JSON.stringify(comparison(body)) && (entry.kind !== 'questionAttachments' || options.attachmentsAvailable?.(body.questionId) !== false)) continue;
    const stamp = Math.max(options.now(), Number(body.updatedAt) + 1, Number(body.createdAt) || 0, Number(body.lastUsedAt ?? 0) + 1,
      Number(current?.updatedAt ?? 0) + 1, Number(current?.lastUsedAt ?? 0) + 1, Number(current?.deletedAt ?? 0) + 1, Number(original?.updatedAt ?? 0) + 1);
    if (!Number.isSafeInteger(stamp)) throw new Error('backup_invalid');
    body = { ...body, updatedAt: stamp, deviceId: entry.kind === 'draft' ? `backup:${id}` : options.deviceId() };
    if (entry.kind === 'workspace' && entry.body.participation) {
      const updatedAt = Math.max(stamp, Number(body.participation.updatedAt) + 1, Number(current?.participation?.updatedAt ?? 0) + 1);
      body.participation = { sites: body.participation.sites, updatedAt, deviceId: body.deviceId };
    }
    if (entry.kind === 'history') body.lastUsedAt = Math.max(stamp, body.lastUsedAt);
    projectBody(entry.kind, body, entry.id);
    snapshot.set(`${entry.kind}:${id}`, body);
    writes.push({ kind: entry.kind, id, body, key });
  }
  const result: BackupSelectionPreview = { imported: writes.length, skipped: entries.length - writes.length, keys: writes.map(write => write.key) };
  return { writes, result };
}
