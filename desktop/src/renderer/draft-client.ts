import { parseDraftInput, parseStoredDraft, type DraftInput, type DraftKind, type StoredDraft } from '../shared/drafts';
import type { DraftReceipt } from './draft-receipt';

export interface DraftClientApi {
  readonly listDrafts?: (kind?: DraftKind, context?: string) => Promise<{ epoch: number; deviceId: string; drafts: readonly StoredDraft[] }>;
  readonly saveDraft?: (input: DraftInput, epoch: number) => Promise<StoredDraft>;
  readonly removeDraft?: (id: string, updatedAt: number, epoch: number) => Promise<boolean>;
  readonly onDraftsChanged?: (listener: () => void) => () => void;
}

export type DraftSaveStatus = 'ready' | 'loading' | 'saving' | 'saved' | 'error';
export interface DraftClientSnapshot {
  readonly drafts: readonly StoredDraft[];
  readonly deviceId: string;
  readonly status: DraftSaveStatus;
  readonly busy: boolean;
}
interface Task {
  readonly input: DraftInput;
  readonly signature: string;
  readonly generation: number;
  readonly revision: number;
  readonly epoch: number;
  readonly deviceId: string;
}
interface Saved { readonly task: Task; readonly draft: StoredDraft; }
export const DRAFT_AUTOSAVE_DELAY = 600;

/** Serial writes prevent a delayed old acknowledgement from reviving cleared work. */
export class PersistentDraftClient {
  private input: DraftInput | null = null;
  private signature = '';
  private generation = 0;
  private revision = 0;
  private mainEpoch: number | null = null;
  private deviceId = '';
  private enabled = true;
  private dirty = true;
  private suppressedRevision = -1;
  private resetBaseline: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<Saved | null> = Promise.resolve(null);
  private saved: Saved | null = null;
  private writing: Task | null = null;
  private refreshSequence = 0;
  private drafts: StoredDraft[] = [];
  private status: DraftSaveStatus = 'ready';
  private mounted = true;

  constructor(private readonly api: DraftClientApi, private readonly onChange: () => void) {}

  edit(value: DraftInput, enabled = true, dirty = true): void {
    const input = parseDraftInput(value), signature = input ? JSON.stringify(input) : '';
    if (this.input && (input?.kind !== this.input.kind || input?.context !== this.input.context)) {
      this.flushOnLeave();
      this.cancelTimer(); this.generation++; this.refreshSequence++; this.tail = Promise.resolve(null);
      this.saved = null; this.mainEpoch = null; this.drafts = []; this.status = 'ready'; this.resetBaseline = null;
    }
    if (this.signature !== signature) this.revision++;
    this.input = input; this.signature = signature; this.enabled = enabled; this.dirty = dirty;
    if (this.resetBaseline !== signature) this.resetBaseline = null;
    if (!enabled || !dirty) this.cancelTimer();
  }

  currentInput(): DraftInput | null { return this.input; }
  snapshot(): DraftClientSnapshot {
    return { drafts: this.drafts, deviceId: this.deviceId, status: this.status, busy: this.status === 'saving' };
  }
  activate(): void { this.mounted = true; }

  schedule(): void {
    this.cancelTimer();
    if (!this.capture() || this.saved?.task.signature === this.signature) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, DRAFT_AUTOSAVE_DELAY);
  }

  async refresh(): Promise<void> {
    if (!this.api.listDrafts || !this.input || !this.mounted) return;
    const generation = this.generation, sequence = ++this.refreshSequence;
    if (this.mainEpoch === null) { this.status = 'loading'; this.notify(); }
    try {
      const response = await this.api.listDrafts(this.input.kind, this.input.context);
      if (!this.mounted || generation !== this.generation || sequence !== this.refreshSequence) return;
      if (!Number.isSafeInteger(response.epoch) || response.epoch < 0 || !response.deviceId || !Array.isArray(response.drafts)) throw Error('invalid_draft');
      if (this.mainEpoch !== null && this.mainEpoch !== response.epoch) this.invalidate();
      this.mainEpoch = response.epoch; this.deviceId = response.deviceId;
      this.drafts = response.drafts.flatMap(value => {
        const draft = parseStoredDraft(value);
        return draft && !Object.hasOwn(draft, 'deletedAt') && draft.kind === this.input?.kind && draft.context === this.input?.context ? [draft] : [];
      });
      if (this.status === 'loading') this.status = 'ready';
      this.notify(); this.schedule();
    } catch {
      if (this.mounted && generation === this.generation && sequence === this.refreshSequence) {
        this.status = 'error'; this.notify();
      }
    }
  }

  async flush(): Promise<StoredDraft | null> {
    this.cancelTimer();
    const task = this.capture();
    if (!task) return null;
    const operation = this.tail.then(() => this.write(task));
    this.tail = operation;
    return (await operation)?.draft ?? null;
  }

  async clearSaved(expected?: DraftReceipt): Promise<boolean> {
    if (expected !== undefined) return expected === null ? false : this.clearExpected(expected);
    this.cancelTimer();
    const task = this.capture(false);
    if (!task || !this.api.removeDraft) return false;
    this.suppressedRevision = task.revision;
    const operation = this.tail.then(async previous => {
      if (!this.current(task)) return false;
      let saved = previous?.task.signature === task.signature ? previous :
        this.saved?.task.signature === task.signature ? this.saved : null;
      if (!saved && this.revision === task.revision) saved = await this.write(task, true);
      if (!saved || !this.current(task) || saved.draft.deviceId !== this.deviceId) return false;
      try {
        const removed = await this.api.removeDraft!(saved.draft.id, saved.draft.updatedAt, task.epoch);
        if (!this.current(task)) return false;
        if (removed && this.saved?.draft.id === saved.draft.id && this.saved.draft.updatedAt === saved.draft.updatedAt) this.saved = null;
        if (this.revision === task.revision) this.status = removed ? 'ready' : 'error';
        await this.refresh(); return removed === true;
      } catch { if (this.current(task)) { this.status = 'error'; this.notify(); } return false; }
    });
    this.tail = operation.then(() => null);
    return operation;
  }

  invalidate(): void {
    this.cancelTimer(); this.generation++; this.refreshSequence++; this.mainEpoch = null;
    this.resetBaseline = this.signature; this.tail = Promise.resolve(null); this.saved = null;
    this.drafts = []; this.status = 'ready'; this.notify();
  }
  dispose(): void { this.flushOnLeave(); this.mounted = false; this.cancelTimer(); this.generation++; }

  isCurrentDraft(value: StoredDraft): boolean {
    return this.mounted && this.drafts.some(draft => draft.id === value.id && draft.updatedAt === value.updatedAt &&
      draft.deviceId === value.deviceId && draft.kind === this.input?.kind && draft.context === this.input?.context);
  }

  async remove(value: StoredDraft): Promise<boolean> {
    if (!this.isCurrentDraft(value) || this.mainEpoch === null || !this.api.removeDraft) return false;
    const generation = this.generation, epoch = this.mainEpoch;
    try {
      const removed = await this.api.removeDraft(value.id, value.updatedAt, epoch);
      if (!this.mounted || generation !== this.generation || epoch !== this.mainEpoch) return false;
      if (removed) {
        if (this.saved?.draft.id === value.id) this.saved = null;
        const sameContents = this.input && JSON.stringify([value.kind, value.context, value.title, value.content, value.sourceUpdatedAt]) ===
          JSON.stringify([this.input.kind, this.input.context, this.input.title, this.input.content, this.input.sourceUpdatedAt]);
        if (value.deviceId === this.deviceId && sameContents) { this.cancelTimer(); this.suppressedRevision = this.revision; }
      }
      await this.refresh(); return removed === true;
    } catch { if (this.mounted && generation === this.generation) { this.status = 'error'; this.notify(); } return false; }
  }

  private async clearExpected(value: DraftReceipt): Promise<boolean> {
    // Capture the scope before awaiting a receipt. Ordinary unmount must not cancel
    // cleanup, while reset still invalidates the epoch accepted by main.
    const task = this.capture(false);
    if (!task || !this.api.removeDraft) return false;
    try {
      const expected = parseStoredDraft(await value);
      if (!expected || Object.hasOwn(expected, 'deletedAt') || this.mainEpoch !== task.epoch ||
        expected.deviceId !== task.deviceId || expected.kind !== task.input.kind || expected.context !== task.input.context) return false;
      const same = JSON.stringify({ kind: expected.kind, context: expected.context, title: expected.title,
        content: expected.content, ...(expected.sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt: expected.sourceUpdatedAt }) }) === this.signature;
      if (this.current(task) && same) { this.cancelTimer(); this.suppressedRevision = this.revision; }
      const removed = await this.api.removeDraft(expected.id, expected.updatedAt, task.epoch);
      if (this.current(task)) {
        if (removed && this.saved?.draft.id === expected.id && this.saved.draft.updatedAt === expected.updatedAt) this.saved = null;
        if (removed && same && this.revision === task.revision) this.status = 'ready';
        await this.refresh();
      }
      return removed === true;
    } catch { if (this.current(task)) { this.status = 'error'; this.notify(); } return false; }
  }

  private flushOnLeave(): void {
    const task = this.capture();
    if (!task || this.saved?.task.signature === task.signature ||
      (this.writing?.generation === task.generation && this.writing.signature === task.signature)) return;
    // Dispatch before dropping the generation. Main writes synchronously and verifies epoch;
    // waiting on an old ACK here could place old labor behind a newly opened editor's write.
    void this.api.saveDraft!(task.input, task.epoch).catch(() => undefined);
  }

  private capture(requireDirty = true): Task | null {
    if (!this.mounted || !this.enabled || (requireDirty && !this.dirty) || !this.input || this.mainEpoch === null ||
      this.suppressedRevision === this.revision || this.resetBaseline === this.signature || !this.api.saveDraft) return null;
    return { input: this.input, signature: this.signature, generation: this.generation, revision: this.revision,
      epoch: this.mainEpoch, deviceId: this.deviceId };
  }
  private current(task: Task): boolean { return this.mounted && task.generation === this.generation && task.epoch === this.mainEpoch; }
  private async write(task: Task, force = false): Promise<Saved | null> {
    if (!this.current(task) || this.revision !== task.revision || !this.enabled ||
      (!force && this.suppressedRevision === task.revision)) return null;
    if (this.saved?.task.signature === task.signature) return this.saved;
    this.status = 'saving'; this.writing = task; this.notify();
    try {
      const draft = parseStoredDraft(await this.api.saveDraft!(task.input, task.epoch));
      if (!draft || Object.hasOwn(draft, 'deletedAt') || draft.kind !== task.input.kind ||
        draft.context !== task.input.context || draft.deviceId !== task.deviceId) throw Error('invalid_draft');
      const saved = { task, draft };
      if (!this.current(task)) return saved;
      this.saved = saved;
      if (this.revision === task.revision) { this.status = 'saved'; this.notify(); }
      await this.refresh();
      return saved;
    } catch {
      if (this.current(task) && this.revision === task.revision) { this.status = 'error'; this.notify(); }
      return null;
    } finally { if (this.writing === task) this.writing = null; }
  }
  private cancelTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private notify(): void { if (this.mounted) this.onChange(); }
}
