import { COMMANDS, type CommandDescriptor } from '../shared/commands';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { MenuShortcut } from '../shared/protocol';
import { normalizeAccelerator } from '../shared/accelerators';
import { commandItems, menuShortcutItems, promptShortcutItems, siteZoomShortcutItems, type PaletteCommand } from './command-search';

const GROUPS = ['compose', 'navigate', 'results', 'app', 'view', 'edit'] as const;
const ORDER = [
  'focus-prompt', 'prompt:send', 'new-session', 'set-think', 'set-fast',
  'show-page-1', 'show-page-2', 'show-page-3', 'previous-page', 'next-page', 'site-back', 'site-forward', 'find-page',
  'view:reload', 'view:force-reload', 'collect-answers', 'retry-failed',
  'open-command-palette', 'open-sites', 'open-site-health', 'open-settings',
  'site-zoom:in', 'site-zoom:out', 'site-zoom:reset', 'role:togglefullscreen', 'role:minimize', 'role:close', 'role:quit',
  'role:undo', 'role:redo', 'role:cut', 'role:copy', 'role:paste', 'role:selectall'
];
const APP_PANELS = new Set(['open-command-palette', 'open-sites', 'open-site-health', 'open-settings']);
const EDIT_ROLES = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']);

function unavailableReason(id: string, copy: DesktopCopy, pageCount?: number): string {
  if (id.startsWith('show-page-') || id === 'previous-page' || id === 'next-page')
    return pageCount === undefined ? copy.shortcutPageUnavailable : formatCopy(copy.shortcutPageCount, { count: pageCount });
  if (id === 'site-back') return copy.shortcutNoBack;
  if (id === 'site-forward') return copy.shortcutNoForward;
  if (id === 'retry-failed') return copy.shortcutNoFailures;
  return copy.shortcutUnavailable;
}

/** Reference order is independent of which actions happen to be executable right now. */
export function shortcutReference(available: readonly CommandDescriptor[], copy: DesktopCopy,
  menu: readonly MenuShortcut[], isMac = false, registered: readonly CommandDescriptor[] = COMMANDS,
  pageCount?: number): readonly PaletteCommand[] {
  const enabled = new Set(available.map(command => command.id));
  const listed: PaletteCommand[] = commandItems(registered, copy, { isMac })
    .filter(item => item.accelerator || item.aliases.length).map(item => ({ ...item,
      group: APP_PANELS.has(item.id) ? 'app' : item.group,
      ...(!enabled.has(item.commandId!) ? { unavailable: unavailableReason(item.id, copy, pageCount) } : {})
    }));
  listed.push(...promptShortcutItems(copy), ...siteZoomShortcutItems(copy).map(item => ({ ...item, group: 'view' as const })));
  const extras = menuShortcutItems(menu, listed, isMac).map(item => {
    const source = menu.find(entry => normalizeAccelerator(entry.accelerator, isMac) === normalizeAccelerator(item.accelerator!, isMac));
    const role = source?.role?.toLowerCase();
    const id = source?.id || (role ? `role:${role}` : item.id);
    const group = role && EDIT_ROLES.has(role) ? 'edit' : id.startsWith('view:') ? 'navigate'
      : role || source?.group === copy.viewMenu || source?.group === copy.windowMenu ? 'view' : 'app';
    return { ...item, id, group } as PaletteCommand;
  });
  const rank = (item: PaletteCommand): number => {
    const group = GROUPS.indexOf(item.group as typeof GROUPS[number]);
    const index = ORDER.indexOf(item.id);
    return (group < 0 ? GROUPS.length : group) * 1000 + (index < 0 ? ORDER.length : index);
  };
  return [...listed, ...extras].sort((a, b) => rank(a) - rank(b));
}
