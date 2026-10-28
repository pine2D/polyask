import type { SiteKey } from './contracts';

/** 单行搜索条的总高度（CSS px），布局和渲染共用，不随站点缩放变化。 */
export const SITE_FIND_HEIGHT = 48;
/** 查找期间所有站点视图共同预留，避免后台页在前景位置条下露出。 */
export const SITE_FIND_MARKER_WIDTH = 6;
export const SITE_FIND_MAX_LENGTH = 512;
export const SITE_FIND_TIMEOUT_MS = 4000;
export type SiteFindMenuAction = { readonly kind: 'select'; readonly site: SiteKey } | { readonly kind: 'refresh' } | null;
export type SiteFindScope = 'all' | 'current';
export interface SiteFindRequest { readonly query: string; readonly scope: SiteFindScope }
export interface SiteFindResult {
  readonly site: SiteKey;
  readonly matches: number;
  readonly active: number;
  readonly status: 'pending' | 'ready' | 'unavailable';
  readonly positions?: readonly number[];
}
export interface SiteFindState extends SiteFindRequest {
  readonly open: boolean;
  readonly session: number;
  /** 查找/菜单语义版本；位置摘要不使已打开的菜单失效。 */
  readonly revision: number;
  readonly positionRevision: number;
  readonly focusRequest: number;
  readonly activeSite: SiteKey | null;
  readonly sites: readonly SiteFindResult[];
}
export function initialSiteFindState(): SiteFindState {
  return { open:false, session:0, query:'', scope:'all', revision:0, positionRevision:0, focusRequest:0, activeSite:null, sites:[] };
}
export function parseSiteFindRequest(value: unknown): SiteFindRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { query, scope } = value as Record<string, unknown>;
  return typeof query === 'string' && query.length <= SITE_FIND_MAX_LENGTH &&
    (scope === 'all' || scope === 'current') ? { query, scope } : null;
}
