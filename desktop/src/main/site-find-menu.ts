import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { SiteDefinition } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteFindMenuAction, SiteFindState } from '../shared/site-find';

/** Labels and actions come only from the current main-process search snapshot. */
export function showSiteFindMenu(window: BrowserWindow, state: SiteFindState,
  sites: readonly SiteDefinition[], copy: DesktopCopy): Promise<SiteFindMenuAction> {
  if (window.isDestroyed() || !state.open) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = (action: SiteFindMenuAction) => { if (!settled) { settled = true; resolve(action); } };
    const items: MenuItemConstructorOptions[] = [
      { label: state.scope === 'all' ? copy.findAll : copy.findCurrent, enabled: false },
      ...state.sites.map(result => {
        const site = sites.find(site => site.key === result.site)?.label ?? result.site;
        return { id: 'site:' + result.site, label: result.status === 'unavailable' ? formatCopy(copy.findUnavailable, { site })
          : result.status === 'pending' ? `${site}: ${copy.findSearching}` : formatCopy(copy.findSiteCount, { site, count: result.matches }),
          enabled: result.status === 'ready' && result.matches > 0, type: 'checkbox' as const,
          checked: result.site === state.activeSite, registerAccelerator: false,
          click: () => finish({ kind: 'select', site: result.site }) };
      }),
      { type: 'separator' },
      { id: 'refresh', label: copy.findRefresh, enabled: !!state.query, registerAccelerator: false, click: () => finish({ kind: 'refresh' }) },
      { type: 'separator' },
      { label: copy.findLimit, enabled: false },
      { label: copy.findLimitExclusions, enabled: false }
    ];
    Menu.buildFromTemplate(items).popup({ window, callback: () => finish(null) });
  });
}
