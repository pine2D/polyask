import type { WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import type { SiteStatus } from "../shared/protocol";

interface ReclamationOptions {
  views: Map<SiteKey, WebContentsView>;
  selected: readonly SiteKey[];
  status(site: SiteKey): SiteStatus;
  capturePending(site: SiteKey): boolean;
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
    // A submitted/warning result does not mean generation has finished.
    if (["sending", "submitted", "generating", "warning"].includes(phase)) continue;
    if (options.capturePending(key)) continue;
    options.detach(key);
    options.views.delete(key);
    options.pageStatus.delete(key);
    options.runStatus.delete(key);
    options.forget(key);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}
