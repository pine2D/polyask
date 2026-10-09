import { randomUUID } from 'node:crypto';
import { DRAFT_STATE_PREFIX, DRAFT_SYNC_META_KEY, parseDraftInput, parseStoredDraft, validDraftId,
  type DraftKind, type StoredDraft } from '../shared/drafts';
import { nextSyncTime, validSyncTime } from '../shared/sync';
import type { StateRepository } from './state-repository';
import type { MetaRepository } from './meta-repository';

interface DraftRepositoryOptions {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly deviceId?: () => string;
}

export class DraftRepository {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly currentDeviceId: () => string;
  private lifecycle = 0;

  constructor(private readonly state: StateRepository, private readonly meta: MetaRepository, options: DraftRepositoryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.currentDeviceId = options.deviceId ?? (() => {
      const id = this.meta.get<unknown>('deviceId');
      if (typeof id !== 'string' || !id) throw new Error('device_id_missing');
      return id;
    });
  }

  get(id: string): StoredDraft | null {
    if (!validDraftId(id)) return null;
    const draft = parseStoredDraft(this.state.get(`${DRAFT_STATE_PREFIX}${id}`));
    return draft?.id === id ? draft : null;
  }

  list(kind?: DraftKind, context?: string): StoredDraft[] {
    return this.records().filter(d => !Object.hasOwn(d, 'deletedAt') &&
      (kind === undefined || d.kind === kind) && (context === undefined || d.context === context));
  }

  save(value: unknown, expectedEpoch?: number): StoredDraft {
    this.checkEpoch(expectedEpoch);
    const input = parseDraftInput(value);
    if (!input) throw new Error('invalid_draft');
    const deviceId = this.currentDeviceId();
    const current = this.list(input.kind, input.context).find(d => d.deviceId === deviceId);
    const id = current?.id ?? this.createId();
    if (!current && this.state.get(`${DRAFT_STATE_PREFIX}${id}`) !== null) throw new Error('invalid_draft');
    const draft = parseStoredDraft({ ...input, format: 1, id, deviceId,
      updatedAt: nextSyncTime(this.now(), ...(current ? [current.updatedAt] : [])) });
    if (!draft) throw new Error('invalid_draft');
    this.checkEpoch(expectedEpoch);
    this.state.put(`${DRAFT_STATE_PREFIX}${id}`, draft, draft.updatedAt, this.syncEnabled());
    return draft;
  }

  remove(id: string, expectedUpdatedAt?: number, expectedEpoch?: number): boolean {
    this.checkEpoch(expectedEpoch);
    if (!validDraftId(id) || (expectedUpdatedAt !== undefined && !validSyncTime(expectedUpdatedAt))) throw new Error('invalid_draft');
    const current = this.get(id);
    if (!current || Object.hasOwn(current, 'deletedAt') ||
      (expectedUpdatedAt !== undefined && current.updatedAt > expectedUpdatedAt)) return false;
    const updatedAt = nextSyncTime(this.now(), current.updatedAt);
    const deleted: StoredDraft = { format: 1, id: current.id, kind: current.kind, context: current.context,
      title: '', content: null, deviceId: current.deviceId, updatedAt, deletedAt: updatedAt };
    this.checkEpoch(expectedEpoch);
    this.state.put(`${DRAFT_STATE_PREFIX}${id}`, deleted, updatedAt, this.syncEnabled());
    return true;
  }

  removeOwn(kind: DraftKind, context: string, expectedUpdatedAt?: number, expectedEpoch?: number): boolean {
    this.checkEpoch(expectedEpoch);
    const current = this.list(kind, context).find(d => d.deviceId === this.currentDeviceId());
    return current ? this.remove(current.id, expectedUpdatedAt, expectedEpoch) : false;
  }

  setSyncEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('invalid_draft');
    const wasEnabled = this.syncEnabled();
    this.meta.put(DRAFT_SYNC_META_KEY, enabled);
    if (!enabled || wasEnabled) return;
    // Queue existing versions unchanged; opt-in itself cannot change branch ownership.
    for (const draft of this.records()) this.state.put(`${DRAFT_STATE_PREFIX}${draft.id}`, draft, draft.updatedAt);
  }

  epoch(): number { return this.lifecycle; }
  invalidate(): void { this.lifecycle++; }

  private syncEnabled(): boolean { return this.meta.get(DRAFT_SYNC_META_KEY) === true; }
  private checkEpoch(expected?: number): void {
    if (expected !== undefined && expected !== this.lifecycle) throw new Error('stale_draft_context');
  }
  private records(): StoredDraft[] {
    return this.state.entries(DRAFT_STATE_PREFIX).flatMap(({ key, value }) => {
      const draft = parseStoredDraft(value);
      return draft && key === `${DRAFT_STATE_PREFIX}${draft.id}` ? [draft] : [];
    });
  }
}
