import type { WebContents } from 'electron';
import type { SiteKey } from '../shared/contracts';
import type { LayoutState } from '../shared/protocol';

/** 记录用户实际进入的可见站点，避免离开提问框时回到默认站点。 */
export function bindSiteFocus(contents: WebContents, site: SiteKey, layout: () => LayoutState,
  allowed: () => boolean, activate: (site: SiteKey) => void): void {
  contents.on('focus', () => {
    if (!allowed()) return;
    const current = layout();
    if (current.focused !== site && current.placements.some(placement => placement.key === site)) activate(site);
  });
}
