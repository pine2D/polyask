import { SITE_KEYS, type SiteKey } from './contracts';
import { validSyncTime } from './sync';

export const PARTICIPATION_SETTING = 'amsConsole.participating';
export interface StoredParticipation {
  readonly sites: readonly SiteKey[];
  readonly updatedAt: number;
  readonly deviceId: string;
}

export function parseStoredParticipation(value: unknown): StoredParticipation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<StoredParticipation>;
  if (!Array.isArray(record.sites) || new Set(record.sites).size !== record.sites.length ||
    record.sites.some(site => !SITE_KEYS.includes(site)) || !validSyncTime(record.updatedAt) ||
    typeof record.deviceId !== 'string' || !record.deviceId) return null;
  return { sites: [...record.sites], updatedAt: record.updatedAt, deviceId: record.deviceId };
}
