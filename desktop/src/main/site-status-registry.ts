import type { SiteKey } from "../shared/contracts";
import type { DesktopSurface, SiteStatus } from "../shared/protocol";
import { classifyNetError, isProxyNetCode, type ProxyNetCode } from "./proxy-errors";
import { SITES } from "./sites";
import type { StabilityEventInput } from "./stability-monitor";
import {
  beginSubmissionRun,
  effectiveStatus,
  markStatusRead,
  preserveSubmission,
  statusWithUnread
} from "./status";

export class SiteStatusRegistry {
  readonly pageStatus = new Map<SiteKey, SiteStatus>();
  readonly runStatus = new Map<SiteKey, SiteStatus>();

  constructor(
    private readonly isSiteVisible: (site: SiteKey) => boolean,
    private readonly onStatus: (status: SiteStatus) => void,
    private readonly proxyAuthFailed?: () => boolean
  ) {}

  current(site: SiteKey): SiteStatus {
    const pageStatus = this.pageStatus.get(site) ?? { site, phase: "loading" as const };
    return effectiveStatus(this.runStatus.get(site), pageStatus);
  }

  all(): SiteStatus[] {
    return SITES.map((site) => this.current(site.key));
  }

  loadFailureCode(errno: number): "load_failed" | ProxyNetCode {
    const code = classifyNetError(errno);
    return code === "proxy_failed" && this.proxyAuthFailed?.()
      ? "proxy_auth_failed"
      : code ?? "load_failed";
  }

  pageFailureCode(site: SiteKey): "renderer_crashed" | "load_failed" | ProxyNetCode | null {
    const page = this.pageStatus.get(site);
    const phase = page?.phase;
    const code = page?.code;
    if (phase === "crashed") return "renderer_crashed";
    // 代理类失败透传 onFailure 存下的码（proxy-errors.ts 分类），用户才知道该去查代理而不是站点。
    if (phase === "failed" && isProxyNetCode(code)) return code;
    if (phase === "failed") return "load_failed";
    return null;
  }

  pageLifecycleCallbacks(site: SiteKey, onRuntimeEvent: (event: StabilityEventInput) => void) {
    return {
      onLoading: () => this.updatePage({ site, phase: "loading" }),
      onReady: () => this.updatePage({ site, phase: "ready" }),
      onFailure: (code: number) => {
        this.updatePage({ site, phase: "failed", code: this.loadFailureCode(code) });
        onRuntimeEvent({ type: "did-fail-load", site, code: String(code) });
      },
      onCrash: (reason: string) => {
        this.updatePage({ site, phase: "crashed", code: "renderer_crashed" });
        onRuntimeEvent({ type: "render-process-gone", site, code: reason });
      }
    };
  }

  updatePage(status: SiteStatus): void {
    this.pageStatus.set(status.site, statusWithUnread(status, this.isSiteVisible(status.site)));
    this.onStatus(this.current(status.site));
  }

  markRun(status: SiteStatus): void {
    this.runStatus.set(
      status.site,
      statusWithUnread(preserveSubmission(this.runStatus.get(status.site), status), this.isSiteVisible(status.site))
    );
    this.onStatus(this.current(status.site));
  }

  beginNavigation(site: SiteKey): void {
    this.runStatus.delete(site);
    this.updatePage({ site, phase: "loading" });
  }

  abandonNavigation(site: SiteKey, abandoned?: "failed" | "ready"): void {
    this.runStatus.delete(site);
    this.updatePage(
      abandoned === "failed" ? { site, phase: "failed", code: "load_failed" } : { site, phase: abandoned ?? "loading" }
    );
  }

  beginSubmission(resumed: boolean): void {
    beginSubmissionRun(resumed, this.runStatus, (site) => this.onStatus(this.current(site)));
  }

  resetRun(): void {
    this.runStatus.clear();
    for (const site of SITES) this.onStatus(this.current(site.key));
  }

  clearVisibleUnread(surface: DesktopSurface, visibleSites: readonly SiteKey[]): void {
    // Mirror isSiteVisible: paging or reselecting while the archive, settings or
    // command surface is up must not mark hidden site badges as read.
    if (surface !== "sites") return;
    for (const site of visibleSites) {
      for (const statuses of [this.pageStatus, this.runStatus]) {
        const status = statuses.get(site);
        if (status?.unread) statuses.set(site, markStatusRead(status));
      }
      this.onStatus(this.current(site));
    }
  }
}
