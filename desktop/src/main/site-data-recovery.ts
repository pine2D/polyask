import type { Session, WebContents, WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import { SITES } from "./sites";

// Clear only CacheStorage and Service Workers. Cookies and site preferences stay.
export async function clearSiteDataAndReload(
  site: SiteKey, siteSession: Session, getView: () => WebContentsView | undefined,
  reloadAllowed: () => boolean, reload: (contents: WebContents) => void
): Promise<boolean> {
  const view = getView();
  const definition = SITES.find(candidate => candidate.key === site);
  if (!view || view.webContents.isDestroyed() || !definition || !reloadAllowed()) return false;
  await siteSession.clearStorageData({
    origin: `https://${definition.host}`,
    storages: ["cachestorage", "serviceworkers"]
  });
  // A new run or a deselection can change the view while the storage operation awaits.
  const live = getView();
  if (live !== view || live.webContents.isDestroyed() || !reloadAllowed()) return false;
  reload(live.webContents);
  return true;
}
