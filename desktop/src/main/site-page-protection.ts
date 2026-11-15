import type { WebContentsView } from 'electron';
import type { SiteKey } from '../shared/contracts';
import type { SiteStatus } from '../shared/protocol';
import { GENERATION_MISS_LIMIT } from './generation-monitor';
import type { GenerationWatcher } from './generation-watcher';
import type { SiteStatusRegistry } from './site-status-registry';
import { reclaimUnselectedViews, sitePageCloseReason } from './view-reclamation';

/** 页面故障与生成证据是两条通道；故障不会取消未结束的本轮保护。 */
export function protectedPagePhase(status: SiteStatus): SiteStatus['phase'] {
  if (status.generation?.state === 'generating') return 'generating';
  if (status.generation?.state === 'submitted') return 'submitted';
  if (status.generation?.state === 'unconfirmed') return 'warning';
  return status.phase;
}
/**
 * 没有生成监视截止时间时：「提交未确认」本就不开监视（只有迟到确认升级后才开，那时采集仍在保护页面），
 * 不能等一个永远不会到来的截止；已提交但监视尚未开始的站继续保护。
 */
export function generationEndedForRelease(status: SiteStatus, deadline: number | undefined,
  misses: number, captureConfirmed: boolean): boolean {
  const stopped = deadline === undefined ? status.phase === 'warning' || status.generation?.state === 'unconfirmed'
    : misses >= GENERATION_MISS_LIMIT || Date.now() >= deadline;
  return stopped && captureConfirmed;
}

export class CaptureReleaseGuards {
  pending: (site: SiteKey) => boolean = () => false;
  releaseConfirmed: (site: SiteKey) => boolean = () => false;
  invalidateRelease: (sites: readonly SiteKey[]) => void = () => {};

  update(
    check: (site: SiteKey) => boolean,
    releaseConfirmed: (site: SiteKey) => boolean = () => false,
    invalidateRelease: (sites: readonly SiteKey[]) => void = () => {}
  ): void {
    this.pending = check;
    this.releaseConfirmed = releaseConfirmed;
    this.invalidateRelease = invalidateRelease;
  }

  closeReason(
    site: SiteKey,
    statuses: SiteStatusRegistry,
    navigating: boolean,
    generationWatcher: GenerationWatcher
  ): ReturnType<typeof sitePageCloseReason> {
    const current = statuses.current(site);
    return sitePageCloseReason({
      phase: protectedPagePhase(current),
      capturePending: this.pending(site),
      navigating,
      observationEnded: generationWatcher.observationEnded(site, current, this.releaseConfirmed(site))
    });
  }

  reclaimUnselected(options: {
    views: Map<SiteKey, WebContentsView>;
    selected: readonly SiteKey[];
    statuses: SiteStatusRegistry;
    generationWatcher: GenerationWatcher;
    navigating: (site: SiteKey) => boolean;
    detach: (site: SiteKey) => void;
  }): void {
    reclaimUnselectedViews({
      views: options.views,
      selected: options.selected,
      status: (site) => ({ ...options.statuses.current(site), phase: protectedPagePhase(options.statuses.current(site)) }),
      capturePending: this.pending,
      detach: options.detach,
      observationEnded: (site) => options.generationWatcher.observationEnded(site, options.statuses.current(site), this.releaseConfirmed(site)),
      navigating: options.navigating,
      pageStatus: options.statuses.pageStatus,
      runStatus: options.statuses.runStatus,
      forget: (site) => options.generationWatcher.invalidate(site)
    });
  }
}
