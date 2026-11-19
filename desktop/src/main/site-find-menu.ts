import type { BrowserWindow } from "electron";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteFindMenuAction, SiteFindState } from "../shared/site-find";
import { showPlatinumPopupMenu, type PlatinumPopupEntry } from "./platinum-popup-menu";

export function buildSiteFindMenuEntries(
  state: SiteFindState,
  sites: readonly SiteDefinition[],
  copy: DesktopCopy
): PlatinumPopupEntry<string>[] {
  return [
    { label: state.scope === "all" ? copy.findAll : copy.findCurrent, enabled: false },
    ...state.sites.map((result) => {
      const site = sites.find((candidate) => candidate.key === result.site)?.label ?? result.site;
      return {
        id: `site:${result.site}`,
        label: result.status === "unavailable"
          ? formatCopy(copy.findUnavailable, { site })
          : result.status === "pending"
            ? `${site}: ${copy.findSearching}`
            : formatCopy(copy.findSiteCount, { site, count: result.matches }),
        enabled: result.status === "ready" && result.matches > 0,
        checkable: true,
        checked: result.site === state.activeSite
      };
    }),
    { type: "separator" },
    { id: "refresh", label: copy.findRefresh, enabled: !!state.query },
    { type: "separator" },
    { label: copy.findLimit, enabled: false },
    { label: copy.findLimitExclusions, enabled: false }
  ];
}

/** Labels and actions come only from the current main-process search snapshot. */
export async function showSiteFindMenu(
  window: BrowserWindow,
  state: SiteFindState,
  sites: readonly SiteDefinition[],
  copy: DesktopCopy,
  anchor?: unknown
): Promise<SiteFindMenuAction> {
  if (window.isDestroyed() || !state.open) return null;
  const entries = buildSiteFindMenuEntries(state, sites, copy);
  const picked = await showPlatinumPopupMenu(window, entries, anchor, "end");
  if (!picked) return null;
  if (picked === "refresh") return { kind: "refresh" };
  if (picked.startsWith("site:")) return { kind: "select", site: picked.slice(5) as SiteKey };
  return null;
}
