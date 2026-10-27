import type {
  CommandDescriptor,
  CommandGroup,
  CommandId
} from "../shared/commands";
import { normalizeAccelerator } from "../shared/accelerators";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { MenuShortcut } from "../shared/protocol";
import type { ActiveWorkspaceGroup } from "../shared/workspace";
import { SITE_ZOOM_SHORTCUTS } from "../shared/site-zoom";
import { shortcutLabel } from './shortcut-label';

export type PaletteGroup = CommandGroup | "saved" | "menu";

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly group: PaletteGroup;
  readonly accelerator?: string;
  readonly aliases: readonly string[];
  readonly searchTerms?: readonly string[];
  readonly commandId?: CommandId;
  readonly groupId?: string;
}

interface SearchOptions {
  readonly groups?: readonly ActiveWorkspaceGroup[];
  readonly isMac?: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

const GROUP_LABEL_KEYS = {
  navigate: 'commandGroupNavigate', compose: 'commandGroupCompose', results: 'commandGroupResults',
  app: 'commandGroupApp', saved: 'commandGroupSaved', menu: 'commandGroupMenu'
} as const;

export function paletteGroupLabel(copy: DesktopCopy, group: PaletteGroup): string {
  return copy[GROUP_LABEL_KEYS[group]];
}

export function filterPaletteCommands(query: string, items: readonly PaletteCommand[], copy: DesktopCopy, isMac = false): readonly PaletteCommand[] {
  const terms = normalized(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter(item => {
    const keys = [item.accelerator, ...item.aliases].filter((value): value is string => !!value);
    const haystack = normalized([item.label, item.id, paletteGroupLabel(copy, item.group), ...(item.searchTerms ?? []), ...keys,
      ...keys.map(value => shortcutLabel(value, isMac))].join(' '));
    return terms.every(term => haystack.includes(term));
  });
}

export function promptShortcutItems(copy: DesktopCopy): readonly PaletteCommand[] {
  // 提问框内的快捷键只作参考，不注册为可执行命令；检索词不作为额外键位展示。
  return [{
    id: "prompt:send", label: copy.sendPromptShortcut, group: "compose",
    accelerator: "CmdOrCtrl+Enter", aliases: [], searchTerms: ["send", "发送", "發送", "↵", "Ctrl+↵"]
  }];
}

export function siteZoomShortcutItems(copy: DesktopCopy): readonly PaletteCommand[] {
  return SITE_ZOOM_SHORTCUTS.map(item => ({
    id: `site-zoom:${item.action}`, label: copy[item.labelKey], group: "navigate",
    accelerator: item.accelerator, aliases: []
  }));
}

// 菜单里由 Electron 给加速器的 role 项（重新加载/缩放/全屏/复制/退出…）不在 COMMANDS 表里，
// 速查只渲染该表就会漏掉它们。这里把主进程读来的**真实菜单**补进速查，并按加速器与已列出的
// 条目去重（我们自己那批命令本来就在菜单里，不去重会出现两遍）。这类条目不可执行，只作参考。
export function menuShortcutItems(
  shortcuts: readonly MenuShortcut[],
  listed: readonly PaletteCommand[],
  isMac = false
): readonly PaletteCommand[] {
  const seen = new Set(listed
    .map((item) => item.accelerator)
    .filter((value): value is string => !!value)
    .map((value) => normalizeAccelerator(value, isMac)));
  const items: PaletteCommand[] = [];
  const palette = listed.find(item => item.commandId === 'open-command-palette');
  for (const shortcut of shortcuts) {
    // An older menu read may finish while the live palette binding is changing.
    if (palette && shortcut.label === palette.label) continue;
    const key = normalizeAccelerator(shortcut.accelerator, isMac);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `menu:${shortcut.group}:${shortcut.label}`,
      label: shortcut.label,
      group: "menu",
      accelerator: shortcut.accelerator,
      aliases: []
    });
  }
  return items;
}

export function commandItems(
  commands: readonly CommandDescriptor[],
  copy: DesktopCopy,
  options: SearchOptions = {}
): readonly PaletteCommand[] {
  const registered = commands.map((command): PaletteCommand => ({
    id: command.id,
    label: copy[command.labelKey],
    group: command.group,
    accelerator: options.isMac
      ? command.macAccelerator ?? command.accelerator
      : command.accelerator,
    aliases: command.aliases ?? [],
    commandId: command.id
  }));
  const saved = (options.groups ?? []).map((group): PaletteCommand => ({
    id: `apply-group:${group.id}`,
    label: formatCopy(copy.applySavedGroup, { group: group.name }),
    group: "saved",
    aliases: [group.name],
    groupId: group.id
  }));
  return [...registered, ...saved];
}

export function searchCommands(
  query: string,
  commands: readonly CommandDescriptor[],
  copy: DesktopCopy,
  options: SearchOptions = {}
): readonly PaletteCommand[] {
  return filterPaletteCommands(query, commandItems(commands, copy, options), copy, options.isMac);
}
