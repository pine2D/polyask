export const BACKUP_MAX_BYTES = 32 * 1024 * 1024;
export const BACKUP_MAX_ENTRIES = 20000;
export const BACKUP_KINDS = ["history", "archive", "decision", "folder", "folderMembership", "template", "group", "workspace"] as const;
export type BackupKind = typeof BACKUP_KINDS[number];
export interface BackupEntry {
  readonly kind: BackupKind;
  readonly id: string;
  readonly body: Readonly<Record<string, unknown>>;
}
export interface BackupDocument {
  readonly format: "polyask-backup";
  readonly version: 1;
  readonly exportedAt: number;
  readonly entries: readonly BackupEntry[];
}
export type BackupNote = "folder_new_identity" | "folder_reused" | "dependency_required";
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
}
export interface BackupPreview {
  readonly token: string;
  readonly filename?: string;
  readonly exportedAt: number;
  readonly items: readonly BackupPreviewItem[];
}
export interface BackupApplyResult {
  readonly imported: number;
  readonly skipped: number;
}
