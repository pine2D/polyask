export const BACKUP_CONTAINER_MAX_BYTES = 512 * 1024 * 1024;
export const BACKUP_MAGIC = "POLYASK-BACKUP-4\n";
export const BACKUP_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;
export const BACKUP_MAX_ENTRIES = 20000;
export const BACKUP_KINDS = ["history", "archive", "decision", "folder", "folderMembership", "template", "group", "workspace", "question", "questionAnswer", "questionAttachments", "preference", "draft"] as const;
export type BackupKind = typeof BACKUP_KINDS[number];
export interface BackupEntry {
  readonly kind: BackupKind;
  readonly id: string;
  readonly body: Readonly<Record<string, unknown>>;
}
export interface BackupDocument {
  readonly format: "polyask-backup";
  readonly version: 1 | 2 | 3 | 4;
  readonly exportedAt: number;
  readonly entries: readonly BackupEntry[];
  readonly payloads?: readonly BackupPayload[];
  readonly omissions?: readonly BackupOmission[];
}
export type BackupNote = "originals_unavailable" | "question_new_identity" | "folder_new_identity" | "folder_reused" | "dependency_required" | "draft_new_identity" | "draft_reused";
export interface BackupPreviewItem {
  readonly key: string;
  readonly kind: BackupKind;
  readonly id: string;
  readonly title: string;
  readonly status: "new" | "same" | "conflict" | "deleted";
  readonly local: Readonly<Record<string, unknown>> | null;
  readonly backup: Readonly<Record<string, unknown>>;
  readonly note?: BackupNote;
  readonly blocked?: boolean;
  readonly requires?: readonly string[];
  /** Read-only preview hints; never persisted or included in exported documents. */
  readonly source?: { readonly key: string; readonly title: string; readonly available: boolean };
  readonly reusesIdentity?: boolean;
}
export interface BackupPreview {
  readonly token: string;
  readonly filename?: string;
  readonly omissions?: readonly BackupOmission[];
  readonly exportedAt: number;
  readonly items: readonly BackupPreviewItem[];
}
export interface BackupApplyResult {
  readonly imported: number;
  readonly skipped: number;
}
export interface BackupSelectionPreview extends BackupApplyResult {
  readonly keys: readonly string[];
}

export interface BackupPayload {
  readonly key: string;
  readonly setId: string;
  readonly index: number;
  readonly size: number;
  readonly sha256: string;
}
export interface BackupOmission {
  readonly questionId: string;
  readonly count: number;
  readonly images: readonly import('./question-attachments').QuestionImageMetadata[];
}
export interface BackupMissingOriginals extends BackupOmission { readonly title: string }
export type BackupExportMode = 'complete' | 'download' | 'text-only';
export type BackupExportResult = boolean | 'text-only' | { readonly missing: readonly BackupMissingOriginals[] };
