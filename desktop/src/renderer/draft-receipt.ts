import type { StoredDraft } from '../shared/drafts';

// Local autosave can finish independently of a formal send/save operation.
export type DraftReceipt = StoredDraft | null | Promise<StoredDraft | null>;
