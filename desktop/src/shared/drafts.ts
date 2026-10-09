import { validSyncTime } from './sync';

export const DRAFT_KINDS = ['prompt', 'comparison', 'decision', 'synthesis'] as const;
export type DraftKind = 'prompt' | 'comparison' | 'decision' | 'synthesis';
export interface DraftInput {
  readonly kind: DraftKind;
  readonly context: string;
  readonly title: string;
  readonly content: unknown;
  readonly sourceUpdatedAt?: number;
}
export interface StoredDraft extends DraftInput {
  readonly id: string;
  readonly updatedAt: number;
  readonly deviceId: string;
  readonly deletedAt?: number;
  readonly format: 1;
}
export const DRAFT_SYNC_META_KEY = 'draftSyncEnabled';
export const DRAFT_STATE_PREFIX = 'draft:';
export const DRAFT_SETTING_PREFIX = 'polyask.draft.';
export const DRAFT_BYTE_LIMIT = 512 * 1024;
export const DRAFT_DEPTH_LIMIT = 32;
export const DRAFT_TITLE_LIMIT = 160;
export const DRAFT_CONTEXT_LIMIT = 512;

const inputFields = ['kind', 'context', 'title', 'content', 'sourceUpdatedAt'];
const storedFields = [...inputFields, 'format', 'id', 'updatedAt', 'deviceId', 'deletedAt'];
const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
const encoder = new TextEncoder();

export function validDraftId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate before stringify: JSON coercion must never silently lose form fields. */
function jsonClone(value: unknown): unknown {
  let remaining = DRAFT_BYTE_LIMIT, nodes = 40_000;
  const visiting = new Set<object>();
  const take = (text: string) => {
    if (text.length > remaining) throw new Error('invalid_draft');
    remaining -= encoder.encode(text).length;
    if (remaining < 0) throw new Error('invalid_draft');
  };
  const walk = (item: unknown, depth: number): void => {
    if (--nodes < 0 || depth > DRAFT_DEPTH_LIMIT) throw new Error('invalid_draft');
    if (item === null || typeof item === 'boolean' || typeof item === 'string' ||
      (typeof item === 'number' && Number.isFinite(item))) {
      if (typeof item === 'string' && item.length > remaining) throw new Error('invalid_draft');
      take(JSON.stringify(item)); return;
    }
    if (!item || typeof item !== 'object' || visiting.has(item)) throw new Error('invalid_draft');
    const array = Array.isArray(item);
    if (array && Object.getPrototypeOf(item) !== Array.prototype) throw new Error('invalid_draft');
    if (!array && !plain(item)) throw new Error('invalid_draft');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > nodes || keys.some(key => typeof key !== 'string' || dangerousKeys.has(key))) throw new Error('invalid_draft');
    if (array && (keys.length !== item.length + 1 ||
      keys.some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(String(key))))) throw new Error('invalid_draft');
    visiting.add(item); take(array ? '[' : '{');
    let count = 0;
    for (const key of keys as string[]) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('invalid_draft');
      if (count++) take(',');
      if (!array) { take(JSON.stringify(key)); take(':'); }
      walk(descriptor.value, depth + 1);
    }
    take(array ? ']' : '}'); visiting.delete(item);
  };
  walk(value, 0);
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function validInput(item: Record<string, unknown>): boolean {
  return DRAFT_KINDS.includes(item.kind as DraftKind) &&
    typeof item.context === 'string' && [...item.context].length <= DRAFT_CONTEXT_LIMIT &&
    typeof item.title === 'string' && [...item.title].length <= DRAFT_TITLE_LIMIT &&
    Object.hasOwn(item, 'content') &&
    (!Object.hasOwn(item, 'sourceUpdatedAt') || validSyncTime(item.sourceUpdatedAt));
}

export function parseDraftInput(value: unknown): DraftInput | null {
  try {
    const item = jsonClone(value);
    if (!plain(item) || Object.keys(item).some(key => !inputFields.includes(key)) || !validInput(item)) return null;
    return item as unknown as DraftInput;
  } catch { return null; }
}

export function parseStoredDraft(value: unknown): StoredDraft | null {
  try {
    const item = jsonClone(value);
    if (!plain(item) || Object.keys(item).some(key => !storedFields.includes(key)) || !validInput(item) ||
      item.format !== 1 || !validDraftId(item.id) || !validSyncTime(item.updatedAt) ||
      typeof item.deviceId !== 'string' || !item.deviceId || item.deviceId.length > 256 ||
      (Object.hasOwn(item, 'deletedAt') && (!validSyncTime(item.deletedAt) || item.deletedAt !== item.updatedAt))) return null;
    // Tombstones contain identity only; deleted editing labor must not survive ingestion.
    if (Object.hasOwn(item, 'deletedAt') &&
      (item.title !== '' || item.content !== null || Object.hasOwn(item, 'sourceUpdatedAt'))) return null;
    return item as unknown as StoredDraft;
  } catch { return null; }
}
