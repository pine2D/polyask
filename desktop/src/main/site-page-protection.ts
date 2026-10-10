import type { SiteStatus } from '../shared/protocol';
import { GENERATION_MISS_LIMIT } from './generation-monitor';

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
