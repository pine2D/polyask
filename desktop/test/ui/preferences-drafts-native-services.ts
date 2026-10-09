import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SyncEngine, type SyncDrive } from '../../src/main/sync-engine';
import { SyncRepository } from '../../src/main/sync-repository';
import type { DesktopDatabase } from '../../src/main/database';
import type { DriveFile } from '../../src/main/drive-client';

export { DesktopDatabase } from '../../src/main/database';
export { WorkspaceService } from '../../src/main/workspace-service';
export { PreferencesRepository } from '../../src/main/preferences-repository';
export { DraftRepository } from '../../src/main/draft-repository';
export { PreferenceRuntime } from '../../src/main/preference-runtime';
export { registerPreferencesDraftsIpc } from '../../src/main/preferences-drafts-ipc';
export { registerWorkspaceSelectionIpc } from '../../src/main/workspace-selection-ipc';
export { createLocalDataServices } from '../../src/main/local-data-services';
export { registerDecisionIpc } from '../../src/main/decision-ipc';
export { registerTaskFolderIpc } from '../../src/main/task-folder-ipc';
export { createArchiveRecord } from '../../src/shared/archive';
export { getCopy } from '../../src/shared/copy';
export { SITES } from '../../src/main/sites';

/** Synthetic file transport only: the production engine still merges and uploads. */
export class NativeCloud implements SyncDrive {
  private readonly files: Map<string, { file: DriveFile; body: unknown }>;
  constructor(private readonly path: string) {
    this.files = new Map(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []);
  }
  async getStartToken(): Promise<string> { return 'native-fixture-token'; }
  async listFiles(): Promise<DriveFile[]> { return [...this.files.values()].map(value => value.file); }
  async listChanges() {
    return { changes: [...this.files.values()].map(value => ({ fileId: value.file.id, file: value.file })),
      newStartPageToken: 'native-fixture-token' };
  }
  async download(id: string): Promise<unknown> { return structuredClone(this.files.get(id)!.body); }
  async upsert(id: string | null, name: string, appProperties: Readonly<Record<string, string>>, body: unknown): Promise<DriveFile> {
    const file = { id: id ?? name, name, appProperties };
    this.files.set(file.id, { file, body: structuredClone(body) });
    writeFileSync(this.path, JSON.stringify([...this.files]));
    return file;
  }
  async clearAll(): Promise<void> { throw new Error('native_fixture_disallows_cloud_delete'); }
}

export function nativeEngine(database: DesktopDatabase, drive: NativeCloud, changed: () => void = () => {}) {
  const repository = new SyncRepository(database);
  repository.saveConfig({ connected: true });
  return new SyncEngine({ repository, drive, onWorkspaceChanged: changed,
    auth: { configured: () => true, securePersistence: () => true, connect: async () => {}, disconnect: async () => {} } });
}
