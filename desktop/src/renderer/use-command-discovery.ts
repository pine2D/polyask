import { useEffect } from 'react';
import type { DesktopSurface, MenuShortcut, SiteHistoryState, SiteStatus } from '../shared/protocol';
import type { SiteKey } from '../shared/contracts';
import { shell } from './shell-api';

export function useCommandDiscovery(options: {
  readonly shortcutRevision?: number;
  readonly focused: SiteKey;
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly surface: DesktopSurface;
  readonly setSiteHistory: (state: Record<string, SiteHistoryState>) => void;
  readonly setMenuShortcuts: (items: readonly MenuShortcut[]) => void;
}): void {
  // Navigation availability follows the focused site's real native history.
  useEffect(() => {
    let cancelled = false;
    void shell.siteHistoryState().then(state => { if (!cancelled) options.setSiteHistory(state); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [options.focused, options.statuses, options.surface]);
  // Rebuilt native menus are the source of truth whenever the reference opens.
  useEffect(() => {
    if (options.surface !== 'commands') return;
    let cancelled = false;
    void shell.menuShortcuts().then(items => { if (!cancelled) options.setMenuShortcuts(items); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [options.surface, options.shortcutRevision]);
}
