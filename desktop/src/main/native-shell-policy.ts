import type { EventEmitter } from 'node:events';
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';
import { DEFAULT_UI_THEME, resolveUiTheme, UI_THEMES, type UiTheme } from '../shared/ui-theme';

const windowThemes = new WeakMap<EventEmitter, UiTheme>();
const UI_THEME_CHANGED = 'polyask-ui-theme-changed';

export function onWindowUiTheme(window: EventEmitter, listener: () => void): () => void {
  window.on(UI_THEME_CHANGED, listener);
  return () => window.off(UI_THEME_CHANGED, listener);
}

export function windowUiTheme(window: EventEmitter): UiTheme {
  return windowThemes.get(window) ?? DEFAULT_UI_THEME;
}

export function setWindowUiTheme(window: EventEmitter, value: string): void {
  const next = resolveUiTheme(value);
  if (windowUiTheme(window) === next) return;
  windowThemes.set(window, next);
  window.emit(UI_THEME_CHANGED, next);
}

export function shellBackground(theme: { readonly shouldUseDarkColors: boolean }, skin: UiTheme = DEFAULT_UI_THEME): string {
  return UI_THEMES[skin].palette.canvas[theme.shouldUseDarkColors ? 1 : 0];
}

export function bindShellTheme(
  window: EventEmitter & { setBackgroundColor(color: string): void },
  theme: EventEmitter & { readonly shouldUseDarkColors: boolean }
): void {
  const update = () => window.setBackgroundColor(shellBackground(theme, windowUiTheme(window)));
  update();
  theme.on('updated', update);
  const unsubscribe = onWindowUiTheme(window, update);
  window.once('closed', () => {
    theme.removeListener('updated', update);
    unsubscribe();
  });
}

type EditContext = Pick<ContextMenuParams, 'isEditable' | 'selectionText'> & {
  readonly editFlags: Pick<ContextMenuParams['editFlags'], 'canUndo' | 'canRedo' | 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>;
};

export function shellContextMenu(params: EditContext): MenuItemConstructorOptions[] {
  const flags = params.editFlags;
  if (!params.isEditable) return params.selectionText && flags.canCopy ? [{ role: 'copy' }] : [];
  return [
    { role: 'undo', enabled: flags.canUndo }, { role: 'redo', enabled: flags.canRedo },
    { type: 'separator' }, { role: 'cut', enabled: flags.canCut },
    { role: 'copy', enabled: flags.canCopy }, { role: 'paste', enabled: flags.canPaste },
    { type: 'separator' }, { role: 'selectAll', enabled: flags.canSelectAll }
  ];
}
