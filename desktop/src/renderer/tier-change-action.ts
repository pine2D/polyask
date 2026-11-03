import type { SiteDefinition } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteRunResult, Tier } from '../shared/protocol';

/** 复用外壳操作锁；反馈独立于发送状态，不能覆盖上一轮提交/生成与采集证据。 */
export function tierChangeAction(options: {
  copy: DesktopCopy; sites: readonly SiteDefinition[];
  run: (action: () => Promise<void>) => Promise<void>;
  change: (tier: Tier) => Promise<readonly SiteRunResult[] | null>;
  announce: (text: string) => void;
}): (tier: Tier) => void {
  return tier => {
    void options.run(async () => {
      const { copy } = options;
      if (tier) options.announce(formatCopy(copy.tierSwitching, { mode: copy[tier] }));
      const results = await options.change(tier);
      if (results === null) return;
      if (!tier) { options.announce(copy.tierFollowing); return; }
      const failed = results.filter(result => !result.ok);
      options.announce(failed.length
        ? formatCopy(copy.tierSwitchPartial, { mode: copy[tier], count: results.length - failed.length,
          sites: failed.map(result => options.sites.find(site => site.key === result.site)?.label ?? result.site).join(' / ') })
        : formatCopy(copy.tierSwitchDone, { mode: copy[tier], count: results.length }));
    });
  };
}
