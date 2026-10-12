import type { Dispatch, SetStateAction } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { RuntimeInfo } from "../shared/runtime";
import type { SiteHealth } from "../shared/site-health";
import type { SiteStatus } from "../shared/protocol";
import { buildSiteReport } from "../shared/site-report";
import { shell } from "./shell-api";

// proxy-state 在主进程可能等钥匙串（最长 10s）；报告的附加行不值得拖住复制。
export const REPORT_PROXY_STATE_TIMEOUT_MS = 1_500;
function withTimeout<T>(task: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); });
  return Promise.race([Promise.resolve(task), timeout]).catch(() => undefined).finally(() => clearTimeout(timer));
}

type HealthState = Partial<Record<SiteKey, SiteHealth>>;
export function siteHealthActions(input: {
  copy: DesktopCopy;
  sites: readonly SiteDefinition[];
  selected: ReadonlySet<SiteKey>;
  runtime: RuntimeInfo;
  statuses: Record<string, SiteStatus>;
  health: HealthState;
  setHealth: Dispatch<SetStateAction<HealthState>>;
  noteHealth: (text: string) => void;
}) {
  const reload = (site: SiteKey, action: () => Promise<boolean>): void => {
    void action().then((ok) => {
      const label = input.sites.find((candidate) => candidate.key === site)?.label ?? site;
      input.noteHealth(formatCopy(ok ? input.copy.healthReloaded : input.copy.healthReloadRejected, { site: label }));
      if (ok) input.setHealth((current) => ({ ...current, [site]: { site, state: "unknown", checks: [] } }));
    }).catch(() => input.noteHealth(input.copy.workspaceActionFailed));
  };
  return {
    onReloadSite: (site: SiteKey) => reload(site, () => shell.reloadSite(site)),
    onHardReloadSite: (site: SiteKey) => reload(site, () => shell.reloadSite(site, true)),
    onClearSiteData: (site: SiteKey) => reload(site, () => shell.clearSiteData(site)),
    onCopyHealthReport: async () => {
      try {
        const processFailures = await shell.getRuntimeProcessFailures();
        // 定位记账与代理行都是报告的附加行：读不到就省略，不让整份报告复制失败。
        const [captureLocate, proxy] = await Promise.all([
          Promise.resolve(shell.getCaptureLocateCounts?.()).catch(() => undefined),
          withTimeout(shell.getProxyState?.(), REPORT_PROXY_STATE_TIMEOUT_MS)
        ]);
        const report = buildSiteReport({
          version: input.runtime.version,
          distribution: input.runtime.distribution,
          platform: navigator.platform,
          scale: window.devicePixelRatio,
          sites: input.sites.filter((site) => input.selected.has(site.key)),
          statuses: input.statuses,
          health: input.health,
          now: Date.now(), processFailures, captureLocate, proxy
        });
        await navigator.clipboard.writeText(report);
        input.noteHealth(input.copy.healthReportCopied);
      } catch { input.noteHealth(input.copy.healthReportCopyFailed); }
    }
  };
}
