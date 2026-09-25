import type { EventEmitter } from 'node:events';
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

export function shellBackground(theme: { readonly shouldUseDarkColors: boolean }): string {
  return theme.shouldUseDarkColors ? '#17171c' : '#f4f5f8';
}

export function bindShellTheme(
  window: EventEmitter & { setBackgroundColor(color: string): void },
  theme: EventEmitter & { readonly shouldUseDarkColors: boolean }
): void {
  const update = () => window.setBackgroundColor(shellBackground(theme));
  update();
  theme.on('updated', update);
  window.once('closed', () => theme.removeListener('updated', update));
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
