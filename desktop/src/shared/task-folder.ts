import type { ArchiveRecord } from "./archive";
import type { DecisionRecord, DecisionStatus } from "./decision";

interface FolderVersion {
  readonly id: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly schema: 3;
}
export interface TaskFolder extends FolderVersion { readonly name: string }
export interface TaskFolderTombstone extends FolderVersion { readonly deletedAt: number }
export type StoredTaskFolder = TaskFolder | TaskFolderTombstone;
export interface FolderTarget { readonly kind: "archive" | "decision"; readonly id: string }
export interface FolderMembership extends FolderVersion {
  readonly folderId: string;
  readonly targetKind: FolderTarget["kind"];
  readonly targetId: string;
}
export type StoredFolderMembership = FolderMembership | (FolderMembership & {readonly deletedAt: number});
export interface FolderMembershipChange { readonly folderId: string; readonly present: boolean }
export interface FolderFilters {
  readonly folderId?: string;
  readonly query?: string;
  readonly kind?: "" | FolderTarget["kind"];
  readonly status?: "" | DecisionStatus;
  readonly tag?: string;
  readonly favorite?: boolean;
}
export type FolderContent = {readonly kind: "archive"; readonly record: ArchiveRecord} |
  {readonly kind: "decision"; readonly record: DecisionRecord};

export const validFolderId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && !!value.trim() && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
export const validFolderName = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && [...value.trim()].length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
export function isFolderTarget(value: unknown): value is FolderTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as FolderTarget;
  return (v.kind === "archive" || v.kind === "decision") && validFolderId(v.id);
}
// Length-prefix encoding keeps imported IDs containing delimiters unambiguous.
export function folderMembershipId(target: FolderTarget, folderId: string): string {
  return `${folderId.length}:${folderId}:${target.kind}:${target.id}`;
}
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function version(v: Partial<FolderVersion & {deletedAt: number}>): boolean {
  return v.schema === 3 && validFolderId(v.deviceId) && time(v.createdAt) && time(v.updatedAt) && v.updatedAt >= v.createdAt &&
    (!("deletedAt" in v) || (time(v.deletedAt) && v.deletedAt >= v.createdAt && v.deletedAt <= v.updatedAt));
}
export function isStoredTaskFolder(value: unknown): value is StoredTaskFolder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<TaskFolder & TaskFolderTombstone>;
  return validFolderId(v.id) && version(v) && ("deletedAt" in v || (validFolderName(v.name) && v.name === v.name.trim()));
}
export function isStoredFolderMembership(value: unknown): value is StoredFolderMembership {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Partial<FolderMembership>;
  const target = {kind:v.targetKind,id:v.targetId};
  return version(v) && validFolderId(v.folderId) && isFolderTarget(target) && v.id === folderMembershipId(target,v.folderId);
}
