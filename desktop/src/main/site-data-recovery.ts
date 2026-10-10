import type { Session, WebContents, WebContentsView } from "electron";
import type { SiteKey } from "../shared/contracts";
import { SITES } from "./sites";

// Clear only CacheStorage and Service Workers. Cookies and site preferences stay.
// attempt() 是本站当前发送尝试的身份：await 期间开了新一轮（含同 runId 重试）就不再重载。
// 只看 phase 不够——刚提交、尚未探到生成的页是 submitted，phase 口径照样放行重载，会冲掉刚发出的提问。
export async function clearSiteDataAndReload(
  site: SiteKey, siteSession: Session, getView: () => WebContentsView | undefined, attempt: () => unknown,
  reloadAllowed: () => boolean, reload: (contents: WebContents) => void
): Promise<boolean> {
  const view = getView();
  const definition = SITES.find(candidate => candidate.key === site);
  if (!view || view.webContents.isDestroyed() || !definition || !reloadAllowed()) return false;
  const run = attempt();
  await siteSession.clearStorageData({
    origin: `https://${definition.host}`,
    storages: ["cachestorage", "serviceworkers"]
  });
  // A new run or a deselection can change the view while the storage operation awaits.
  const live = getView();
  if (live !== view || live.webContents.isDestroyed() || !reloadAllowed() || attempt() !== run) return false;
  reload(live.webContents);
  return true;
}
