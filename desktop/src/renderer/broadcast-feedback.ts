import { formatCopy, type DesktopCopy } from '../shared/copy';
import { cancelledRunSites, failedRunSites, uncertainRunSites, type BroadcastRun } from './broadcast-run';

export function broadcastFeedback(copy: DesktopCopy, run: BroadcastRun): string {
  const cancelled = new Set(cancelledRunSites(run));
  return formatCopy(copy.broadcastSummary, {
    ok: [...run.results.values()].filter(result => result.ok).length,
    failed: failedRunSites(run).length, cancelled: cancelled.size,
    uncertain: uncertainRunSites(run).filter(site => !cancelled.has(site)).length
  });
}
