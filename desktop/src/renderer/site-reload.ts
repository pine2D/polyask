import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import { shell } from "./shell-api";

/** Frame-level reload button: never fire-and-forget; every outcome (rejected, false, thrown) is reported. */
export async function reloadSiteWithFeedback(
  site: SiteKey, copy: DesktopCopy, sites: readonly SiteDefinition[], announce: (text: string) => void
): Promise<void> {
  const label = sites.find((candidate) => candidate.key === site)?.label ?? site;
  try {
    const ok = await shell.reloadSite(site);
    announce(formatCopy(ok ? copy.healthReloaded : copy.healthReloadRejected, { site: label }));
  } catch { announce(copy.workspaceActionFailed); }
}
