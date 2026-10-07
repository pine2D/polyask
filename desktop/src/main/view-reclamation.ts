import type { WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import type { SiteStatus } from "../shared/protocol";
import type { SitePageCloseReason } from '../shared/site-page';

export interface SitePageProtection {
  readonly phase: SiteStatus['phase'];
  readonly capturePending: boolean;
  readonly observationEnded: boolean;
  readonly navigating: boolean;
}

/** One policy protects both explicit close and automatic reclamation. */
export function sitePageCloseReason(state: SitePageProtection): SitePageCloseReason | null {
  if (state.phase === 'sending') return 'sending';
  if (state.capturePending) return 'capture_pending';
  if (state.navigating) return 'navigating';
  if (['submitted', 'generating', 'warning'].includes(state.phase) && !state.observationEnded) return 'generation_pending';
  return null;
}

interface ReclamationOptions {
  views: Map<SiteKey, WebContentsView>;
  selected: readonly SiteKey[];
  status(site: SiteKey): SiteStatus;
  capturePending(site: SiteKey): boolean;
  observationEnded(site: SiteKey): boolean;
  navigating?(site: SiteKey): boolean;
  detach(site: SiteKey): void;
  pageStatus: Map<SiteKey, SiteStatus>;
  runStatus: Map<SiteKey, SiteStatus>;
  forget(site: SiteKey): void;
}

/** Synchronous sweep: selection, generation and capture are checked at disposal time. */
export function reclaimUnselectedViews(options: ReclamationOptions): void {
  for (const [key, view] of [...options.views]) {
    if (options.selected.includes(key)) continue;
    const phase = options.status(key).phase;
    if (sitePageCloseReason({ phase, capturePending: options.capturePending(key),
      navigating: options.navigating?.(key) ?? false, observationEnded: options.observationEnded(key) })) continue;
    options.detach(key);
    options.views.delete(key);
    options.pageStatus.delete(key);
    options.runStatus.delete(key);
    options.forget(key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
