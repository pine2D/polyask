import type { CommandPaletteShortcutMode } from './command-palette-shortcut';
import type { DesktopCopy } from "./copy";
import { normalizeAccelerator } from './accelerators';

export type CommandId =
  | "open-command-palette"
  | "open-sites"
  | "open-site-health"
  | "show-page-1"
  | "show-page-2"
  | "show-page-3"
  | "next-page"
  | "previous-page"
  | "next-site"
  | "previous-site"
  | "site-back"
  | "site-forward"
  | "focus-current-site"
  | "edit-prompt" // 全局唤起只展开，不参与应用内 Alt+Q 切换。
  | "focus-prompt"
  | "find-page"
  | "set-think"
  | "set-fast"
  | "collect-compare"
  | "collect-answers"
  | "open-question-history"
  | "open-archive"
  | "collect-synthesis"
  | "retry-failed"
  | "new-session"
  | "open-settings"
  | "open-display-settings"
  | "open-data-settings"
  | "open-drive-diagnostics"
  | "open-shortcuts"
  | "open-getting-started"
  | "next-unfinished"
  | "next-failed"
  | "check-updates";

export type CommandGroup = "navigate" | "compose" | "results" | "app";

export interface CommandDescriptor {
  readonly id: CommandId;
  readonly labelKey: keyof DesktopCopy;
  readonly group: CommandGroup;
  readonly accelerator?: string;
  readonly macAccelerator?: string;
  readonly aliases?: readonly string[];
}

export interface CommandInput {
  readonly type: string;
  readonly key: string;
  readonly alt: boolean;
  readonly control: boolean;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly isComposing?: boolean;
  readonly code?: string;
  readonly modifiers?: readonly string[];
}

export const COMMANDS: readonly CommandDescriptor[] = Object.freeze([
  { id: "open-command-palette", labelKey: "commandPalette", group: "navigate", accelerator: "CmdOrCtrl+Shift+P" },
  { id: "open-sites", labelKey: "sitesAndGroups", group: "navigate", accelerator: "Alt+S" },
  { id: "open-site-health", labelKey: "siteHealth", group: "navigate", accelerator: "Alt+H" },
  { id: "show-page-1", labelKey: "showPageOne", group: "navigate", accelerator: "Alt+1" },
  { id: "show-page-2", labelKey: "showPageTwo", group: "navigate", accelerator: "Alt+2" },
  { id: "show-page-3", labelKey: "showPageThree", group: "navigate", accelerator: "Alt+3" },
  // 相对站点导航保留命令面板入口，不再占用 Ctrl+PageUp/PageDown。
  { id: "next-page", labelKey: "nextPageMenu", group: "navigate", accelerator: "CmdOrCtrl+Shift+PageDown" },
  { id: "previous-page", labelKey: "previousPageMenu", group: "navigate", accelerator: "CmdOrCtrl+Shift+PageUp" },
  { id: "next-site", labelKey: "nextSiteMenu", group: "navigate" },
  { id: "previous-site", labelKey: "previousSiteMenu", group: "navigate" },
  // 站内导航（点了回答里的站内链接、站点自己的跳转器）之后此前完全没有退路，唯一脱身办法是
  // 「新会话」——那会丢掉当前对话。Alt+方向键避开浏览器/站点自己的 Alt+Left。
  { id: "site-back", labelKey: "siteBackMenu", group: "navigate", accelerator: "Alt+Left" },
  { id: "site-forward", labelKey: "siteForwardMenu", group: "navigate", accelerator: "Alt+Right" },
  { id: "focus-current-site", labelKey: "focusCurrentSiteMenu", group: "navigate" },
  { id: "focus-prompt", labelKey: "focusPromptMenu", group: "compose", accelerator: "Alt+Q" },
  { id: 'find-page', labelKey: 'findPage', group: 'navigate', accelerator: 'CmdOrCtrl+F' },
  { id: "set-think", labelKey: "chooseThinkMode", group: "compose", accelerator: "Alt+T" },
  { id: "set-fast", labelKey: "chooseFastMode", group: "compose", accelerator: "Alt+Y" },
  { id: "collect-compare", labelKey: "collectCompare", group: "results" },
  { id: "collect-answers", labelKey: "collectAnswers", group: "results", accelerator: "Alt+C" },
  { id: "open-question-history", labelKey: "questionHistory", group: "navigate" },
  { id: "open-archive", labelKey: "openArchive", group: "results" },
  { id: "collect-synthesis", labelKey: "synthesisCollect", group: "results" },
  { id: "retry-failed", labelKey: "retryFailedCommand", group: "results", accelerator: "Alt+R" },
  { id: "new-session", labelKey: "newSessionSelected", group: "compose", accelerator: "Alt+N" },
  { id: "open-settings", labelKey: "settings", group: "app", accelerator: "Control+,", macAccelerator: "Command+," },
  { id: "open-display-settings", labelKey: "settingsDisplayTitle", group: "app" },
  { id: "open-data-settings", labelKey: "settingsAdvancedData", group: "app" },
  { id: "open-drive-diagnostics", labelKey: "openDriveDiagnostics", group: "app" },
  { id: "open-shortcuts", labelKey: "keyboardShortcuts", group: "app" },
  { id: "open-getting-started", labelKey: "gettingStarted", group: "app" },
  { id: "next-unfinished", labelKey: "nextUnfinished", group: "results" },
  { id: "next-failed", labelKey: "nextFailed", group: "results" },
  { id: "check-updates", labelKey: "checkForUpdates", group: "app" }
]);

const OBSIDIAN_COMMANDS: readonly CommandDescriptor[] = Object.freeze(COMMANDS.map(command =>
  command.id === 'open-command-palette' ? { ...command, accelerator: 'CmdOrCtrl+P' } : command));
export function resolveCommands(mode: CommandPaletteShortcutMode): readonly CommandDescriptor[] {
  return mode === 'obsidian' ? OBSIDIAN_COMMANDS : COMMANDS;
}
export function commandById(id: string, mode: CommandPaletteShortcutMode = 'standard'): CommandDescriptor | undefined {
  return resolveCommands(mode).find(command => command.id === id);
}
export function commandAccelerator(id: CommandId, platform: NodeJS.Platform, mode: CommandPaletteShortcutMode = 'standard'): string | undefined {
  const command = commandById(id, mode);
  return platform === 'darwin' ? command?.macAccelerator ?? command?.accelerator : command?.accelerator;
}
export function commandAliasForInput(input: CommandInput, platform = 'linux', mode: CommandPaletteShortcutMode = 'standard'): CommandId | undefined {
  if (input.type !== 'keyDown' || input.isComposing || input.modifiers?.some(value => value.toLowerCase() === 'altgr')) return undefined;
  // Option may produce a symbol on macOS; the registered letter still identifies the shortcut.
  const key = platform === 'darwin' && input.alt && /^Key[A-Z]$/.test(input.code ?? '')
    ? input.code!.slice(3).toLowerCase() : input.key.toLowerCase().replace(/^arrow/, '');
  return resolveCommands(mode).find(command => {
    const accelerator = platform === 'darwin' ? command.macAccelerator ?? command.accelerator : command.accelerator;
    if (!accelerator) return false;
    const parts = normalizeAccelerator(accelerator, platform === 'darwin').split('+');
    return parts.at(-1) === key && parts.includes('alt') === input.alt && parts.includes('ctrl') === input.control &&
      parts.includes('cmd') === input.meta && parts.includes('shift') === input.shift;
  })?.id;
}
