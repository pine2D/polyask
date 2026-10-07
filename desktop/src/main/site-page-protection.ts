import type { SiteStatus } from '../shared/protocol';
import { GENERATION_MISS_LIMIT } from './generation-monitor';

/** 页面故障与生成证据是两条通道；故障不会取消未结束的本轮保护。 */
export function protectedPagePhase(status: SiteStatus): SiteStatus['phase'] {
  if (status.generation?.state === 'generating') return 'generating';
  if (status.generation?.state === 'submitted') return 'submitted';
  if (status.generation?.state === 'unconfirmed') return 'warning';
  return status.phase;
}
export function generationEndedForRelease(status: SiteStatus, deadline: number | undefined,
  misses: number, captureConfirmed: boolean): boolean {
  const stopped = deadline === undefined ? status.phase === 'warning'
    : misses >= GENERATION_MISS_LIMIT || Date.now() >= deadline;
  return stopped && captureConfirmed;
}
