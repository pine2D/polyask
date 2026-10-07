import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ShellIpcOptions } from './shell-ipc';
import { SITES } from './sites';

export function registerBootstrapIpc(ipc: Pick<IpcMain, 'handle'>,
  options: ShellIpcOptions, trusted: (event: IpcMainInvokeEvent) => boolean): void {
  ipc.handle('polyask:bootstrap', event => {
    if (!trusted(event)) throw new Error('untrusted_sender');
    return {
      runtime: options.runtime,
      sites: SITES,
      statuses: options.manager.getStatuses(),
      layout: options.manager.getLayout(),
      display: options.manager.getDisplayPreferences(),
      workspace: options.workspace.getState(),
      promptLibrary: options.promptLibrary.getState(),
      pendingSynthesis: options.synthesis.getPending(),
      questionRunProgress: options.questions.getLastRunProgress(),
      sync: options.sync.status()
    };
  });
}
