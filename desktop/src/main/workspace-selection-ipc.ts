import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { WorkspaceState } from '../shared/workspace';
import type { WorkspaceService } from './workspace-service';

export function registerWorkspaceSelectionIpc(ipc: Pick<IpcMain, 'handle'>, workspace: WorkspaceService,
  trusted: (event: IpcMainInvokeEvent) => boolean, publish: () => WorkspaceState): void {
  for (const [channel, apply] of [
    ['polyask:set-selection', (value: unknown) => workspace.setSelection(value)],
    ['polyask:set-tier', (value: unknown) => workspace.setTier(value)],
    ['polyask:set-participation', (value: unknown) => workspace.setParticipation(value)]
  ] as const) {
    ipc.handle(channel, (event, value: unknown) => {
      if (!trusted(event)) throw new Error('untrusted_sender');
      apply(value);
      return publish();
    });
  }
}
