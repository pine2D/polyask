import type { WebContentsView } from "electron";

import type { SiteKey } from "../shared/contracts";
import type { DiagnoseSiteCommand, SiteStatus } from "../shared/protocol";
import { buildSiteHealth, type SiteHealth, type SiteHealthPageState, type SiteHealthRunPhase } from "../shared/site-health";
import { navigationDisposition, type NavigationDisposition } from "./navigation";
import type { SiteCommandChannel } from "./site-command-channel";
import { SITES } from "./sites";

const RECENT_PHASES: readonly SiteHealthRunPhase[] = ["sending", "submitted", "generating", "complete", "warning", "cancelled", "failed"];

/** 单站只读健康检查（从 ViewManager 抽出）：只在页面已就绪且停在本站时发 diagnose，绝不开菜单或导航。 */
export async function checkSiteHealth(site: SiteKey, view: WebContentsView | undefined,
  pageStatus: SiteStatus | undefined, runStatus: SiteStatus | undefined, commands: SiteCommandChannel): Promise<SiteHealth> {
  const definition = SITES.find((candidate) => candidate.key === site);
  const phase = pageStatus?.phase ?? "loading";
  const finish = (checks: unknown, navigation: NavigationDisposition): SiteHealth => {
    const health = buildSiteHealth({ site, phase, navigation, checks });
    const page: SiteHealthPageState = phase === "failed" || phase === "crashed"
      ? "error"
      : phase === "loading" || phase === "ready" ? phase : "unknown";
    const recent = runStatus && RECENT_PHASES.includes(runStatus.phase as SiteHealthRunPhase)
      ? { phase: runStatus.phase as SiteHealthRunPhase, ...(runStatus.code ? { code: runStatus.code } : {}) }
      : undefined;
    return { ...health, page, checkedAt: Date.now(), ...(recent ? { recent } : {}) };
  };
  if (!definition || !view || view.webContents.isDestroyed()) {
    return finish(undefined, "block");
  }
  const navigation = navigationDisposition(definition, view.webContents.getURL());
  if (navigation !== "site" || phase === "loading" || ["failed", "crashed"].includes(phase)) {
    return finish(undefined, navigation);
  }
  const command: DiagnoseSiteCommand = {
    source: "AMS",
    cmd: "diagnose",
    deadline: Date.now() + 2_500
  };
  const response = await commands.send(view.webContents, command, {
    timeoutResult: { code: "not_ready" }
  });
  const checks = "checks" in response ? response.checks : undefined;
  return finish(checks, navigation);
}
