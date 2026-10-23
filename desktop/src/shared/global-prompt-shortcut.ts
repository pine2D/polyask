export type GlobalPromptShortcutError = 'invalid' | 'conflict' | 'unavailable' | 'save_failed';
export interface GlobalPromptShortcutState {
  readonly accelerator: string | null;
  readonly activeAccelerator: string | null;
  readonly status: 'disabled' | 'registered' | 'unavailable';
  readonly error: GlobalPromptShortcutError | null;
}

// A deliberately small, keyboard-selectable set; media and unmodified typing keys are excluded.
export const GLOBAL_PROMPT_SHORTCUT_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`), 'Space'
] as const;

/** null disables; undefined means invalid. Both renderer and main use this bounded grammar. */
export function parseGlobalPromptShortcut(value: unknown, isMac = false): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 80) return undefined;
  const parts = value.split('+').map(part => part.trim().toLowerCase());
  if (parts.length < 2 || parts.length > 5) return undefined;
  const main = parts.pop()!;
  const key = GLOBAL_PROMPT_SHORTCUT_KEYS.find(candidate => candidate.toLowerCase() === main);
  if (!key) return undefined;
  const meta = isMac ? 'Command' : 'Super';
  const aliases: Readonly<Record<string, string>> = {
    control: 'Control', ctrl: 'Control', alt: 'Alt', option: 'Alt', shift: 'Shift',
    command: meta, cmd: meta, super: meta, meta,
    commandorcontrol: isMac ? 'Command' : 'Control', cmdorctrl: isMac ? 'Command' : 'Control'
  };
  const modifiers = parts.map(part => Object.hasOwn(aliases, part) ? aliases[part] : undefined);
  if (modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length
    || !modifiers.some(part => part !== 'Shift')) return undefined;
  return [...['Control', meta, 'Alt', 'Shift'].filter(part => modifiers.includes(part)), key].join('+');
}

export function displayGlobalPromptShortcut(accelerator: string, isMac = false): string {
  return accelerator.replaceAll('Control', 'Ctrl').replaceAll('Command', '⌘')
    .replaceAll('Super', isMac ? '⌘' : 'Super').replaceAll('Alt', isMac ? 'Option' : 'Alt');
}
