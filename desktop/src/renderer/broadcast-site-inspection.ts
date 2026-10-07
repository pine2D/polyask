import type { SiteKey } from '../shared/contracts';

export async function inspectBroadcastSite(site: SiteKey, options: {
  isSelected: (site: SiteKey) => boolean;
  focus: (site: SiteKey) => Promise<boolean>;
  unavailable: (site: SiteKey) => void;
  active?: () => boolean;
}): Promise<void> {
  if (options.active?.() === false) return;
  if (!options.isSelected(site)) { options.unavailable(site); return; }
  let accepted = false;
  try { accepted = (await options.focus(site)) === true; } catch { /* 拒绝或无回执均不能声称查看成功。 */ }
  if (options.active?.() !== false && (!accepted || !options.isSelected(site))) options.unavailable(site);
}
