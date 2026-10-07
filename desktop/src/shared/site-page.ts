import { SITE_KEYS, type SiteKey } from './contracts';
import type { WorkspaceState } from './workspace';

export const SITE_PAGE_CLOSE_REASONS = ['sending', 'generation_pending', 'capture_pending', 'navigating'] as const;
export type SitePageCloseReason = typeof SITE_PAGE_CLOSE_REASONS[number];
export type SitePageBlockedReason = SitePageCloseReason | 'operation_busy' | 'page_changed';
export interface SitePageClosePreview {
  readonly site: SiteKey;
  readonly contentsId: number | null;
  readonly reason: SitePageCloseReason | null;
}
export interface SitePageCloseRequest {
  readonly site: SiteKey;
  readonly contentsId: number;
  readonly confirmed: true;
}
export type SitePageCloseResult =
  | { readonly state: 'closed' | 'not_open'; readonly workspace: WorkspaceState }
  | { readonly state: 'blocked'; readonly reason: SitePageBlockedReason };

export function sitePageKey(value: unknown): SiteKey | null {
  return typeof value === 'string' && SITE_KEYS.includes(value as SiteKey) ? value as SiteKey : null;
}

export function sitePageCloseRequest(value: unknown): SitePageCloseRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>, site = sitePageKey(item.site);
  return site && item.confirmed === true && typeof item.contentsId === 'number' &&
    Number.isSafeInteger(item.contentsId) && item.contentsId > 0
    ? { site, contentsId: item.contentsId, confirmed: true } : null;
}
