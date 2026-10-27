import type { OperationGate } from '../shared/operation-gate';
import type { CommandPaletteShortcutRuntime } from './command-palette-shortcut';

interface IpcRegistry {
  handle(channel: string, listener: (event: any, value?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}
export interface CommandPaletteShortcutIpcOptions {
  readonly ipcMain: IpcRegistry;
  readonly trustedShell: (event: any) => boolean;
  readonly runtime: CommandPaletteShortcutRuntime;
  readonly gate: Pick<OperationGate, 'run'>;
  readonly isResetting: () => boolean;
}

export function registerCommandPaletteShortcutIpc(options: CommandPaletteShortcutIpcOptions): () => void {
  const { ipcMain, runtime, gate } = options;
  let disposed = false;
  const trusted = (event: unknown) => {
    if (disposed || !options.trustedShell(event)) throw new Error('untrusted_sender');
  };
  ipcMain.handle('polyask:command-palette-shortcut-state', event => { trusted(event); return runtime.getState(); });
  ipcMain.handle('polyask:command-palette-shortcut-set', async (event, value) => {
    trusted(event);
    const lifecycle = runtime.lifecycle;
    if (options.isResetting()) throw new Error('operation_busy');
    const state = await gate.run(async () => {
      if (disposed || options.isResetting() || lifecycle !== runtime.lifecycle) throw new Error('operation_busy');
      return runtime.configure(value);
    });
    return disposed || options.isResetting() || lifecycle !== runtime.lifecycle ? runtime.getState() : state;
  });
  return () => {
    disposed = true;
    ipcMain.removeHandler('polyask:command-palette-shortcut-state');
    ipcMain.removeHandler('polyask:command-palette-shortcut-set');
  };
}
