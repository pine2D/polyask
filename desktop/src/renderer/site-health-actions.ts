import type { Dispatch, SetStateAction } from "react";
import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { RuntimeInfo } from "../shared/runtime";
import type { SiteHealth } from "../shared/site-health";
import type { SiteStatus } from "../shared/protocol";
import { buildSiteReport } from "../shared/site-report";
import { shell } from "./shell-api";

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
    onCopyHealthReport: () => {
      const report = buildSiteReport({
        version: input.runtime.version,
        distribution: input.runtime.distribution,
        platform: navigator.platform,
        scale: window.devicePixelRatio,
        sites: input.sites.filter((site) => input.selected.has(site.key)),
        statuses: input.statuses,
        health: input.health,
        now: Date.now()
      });
      void navigator.clipboard.writeText(report).then(
        () => input.noteHealth(input.copy.healthReportCopied),
        () => input.noteHealth(input.copy.healthReportCopyFailed)
      );
    }
  };
}
