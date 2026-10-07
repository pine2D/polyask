import { useEffect, useRef, useState } from 'react';
import type { SiteDefinition, SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { SITE_PAGE_CLOSE_REASONS, type SitePageBlockedReason, type SitePageClosePreview,
  type SitePageCloseRequest, type SitePageCloseResult } from '../shared/site-page';
import type { WorkspaceState } from '../shared/workspace';
import type { ExclusiveActionLock } from './broadcast-flow-state';
import { FolderModal } from './folder-modal';

export interface SitePageCloseApi {
  previewSitePageClose(site: SiteKey): Promise<SitePageClosePreview>;
  closeSitePage(request: SitePageCloseRequest): Promise<SitePageCloseResult>;
}
export interface SitePageCloseOptions {
  readonly copy: DesktopCopy;
  readonly sites: readonly SiteDefinition[];
  readonly busy: boolean;
  readonly api: SitePageCloseApi;
  readonly lock?: Pick<ExclusiveActionLock, 'run'>;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onWorkspace: (workspace: WorkspaceState) => void;
  readonly onAnnounce: (message: string) => void;
}

const BLOCKED_COPY = {
  sending: 'sitePageCloseSending', generation_pending: 'sitePageCloseGeneration',
  capture_pending: 'sitePageCloseCapture', navigating: 'sitePageCloseNavigation',
  operation_busy: 'sitePageCloseBusy', page_changed: 'sitePageCloseChanged'
} satisfies Record<SitePageBlockedReason, keyof DesktopCopy>;

export function useSitePageClose(options: SitePageCloseOptions) {
  const latest = useRef(options); latest.current = options;
  const revision = useRef(0), mounted = useRef(true), blocked = useRef(false), closing = useRef(false);
  const [site, setSite] = useState<SiteKey | null>(null);
  const [preview, setPreview] = useState<SitePageClosePreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; blocked.current = false; };
  }, []);
  const current = (request: number) => mounted.current && request === revision.current;
  const announceReason = (reason: SitePageBlockedReason) => latest.current.onAnnounce(latest.current.copy[BLOCKED_COPY[reason]]);
  const finish = () => {
    revision.current++;
    const wasOpen = blocked.current;
    blocked.current = false; closing.current = false;
    setSite(null); setPreview(null); setSubmitting(false);
    if (wasOpen) latest.current.onClose();
  };
  const request = async (key: SiteKey): Promise<boolean> => {
    if (!mounted.current || blocked.current || latest.current.busy || !latest.current.sites.some(item => item.key === key)) return false;
    const attempt = ++revision.current;
    blocked.current = true; setSite(key); setPreview(null);
    latest.current.onOpen();
    try {
      const next = await latest.current.api.previewSitePageClose(key);
      if (!current(attempt)) return false;
      if (next.site !== key || (next.reason !== null && !SITE_PAGE_CLOSE_REASONS.includes(next.reason)) ||
        (next.contentsId !== null && (!Number.isSafeInteger(next.contentsId) || next.contentsId <= 0))) throw new Error('invalid_response');
      if (latest.current.busy) { announceReason('operation_busy'); finish(); return false; }
      if (next.contentsId === null) { latest.current.onAnnounce(latest.current.copy.sitePageNotOpen); finish(); return false; }
      if (next.reason) { announceReason(next.reason); finish(); return false; }
      setPreview(next);
      return true;
    } catch {
      if (current(attempt)) { latest.current.onAnnounce(latest.current.copy.sitePageCloseFailed); finish(); }
      return false;
    }
  };
  const confirm = async () => {
    if (!preview || closing.current || latest.current.busy) return;
    const attempt = revision.current;
    closing.current = true; setSubmitting(true);
    const action = () => latest.current.api.closeSitePage({ site: preview.site, contentsId: preview.contentsId!, confirmed: true });
    try {
      const result = await (latest.current.lock ? latest.current.lock.run(action) : action());
      if (!current(attempt)) return;
      if (result === null) announceReason('operation_busy');
      else if (result.state === 'blocked') {
        if (!Object.hasOwn(BLOCKED_COPY, result.reason)) throw new Error('invalid_response');
        announceReason(result.reason);
      } else if (result.state === 'closed' || result.state === 'not_open') {
        latest.current.onWorkspace(result.workspace);
        latest.current.onAnnounce(result.state === 'closed' ? latest.current.copy.sitePageClosed : latest.current.copy.sitePageNotOpen);
      } else throw new Error('invalid_response');
      finish();
    } catch {
      if (current(attempt)) { latest.current.onAnnounce(latest.current.copy.sitePageCloseFailed); finish(); }
    }
  };
  const cancel = () => { if (!closing.current) finish(); };
  const label = options.sites.find(item => item.key === site)?.label ?? '';
  const dialog = site ? <FolderModal copy={options.copy} title={formatCopy(options.copy.sitePageCloseTitle, { site: label })}
    busy={submitting} onCancel={cancel}>
    <p>{options.copy.sitePageCloseMessage}</p>
    {!preview ? <p role="status">{options.copy.sitePagePreviewPending}</p> :
      <footer><button type="button" className="site-page-close-confirm" disabled={submitting || options.busy}
        onClick={() => { void confirm(); }}>{options.copy.sitePageCloseConfirm}</button></footer>}
  </FolderModal> : null;
  return { blocking: site !== null, pending: submitting || (site !== null && preview === null), request, cancel,
    invalidate: finish, dialog };
}
