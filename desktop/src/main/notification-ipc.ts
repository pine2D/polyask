import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { NOTIFICATION_CHANNELS } from '../shared/notification';
import type { CompletionNotifications } from './completion-notifications';

export function registerNotificationIpc(options: {
  notifications: Pick<CompletionNotifications, 'status' | 'test'>;
  trusted: (event: IpcMainInvokeEvent) => boolean;
}): () => void {
  const register = (channel: string, action: () => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!options.trusted(event)) throw new Error('untrusted_sender');
      if (args.length) throw new Error('invalid_notification_request');
      return action();
    });
  };
  register(NOTIFICATION_CHANNELS.get, () => options.notifications.status());
  register(NOTIFICATION_CHANNELS.test, () => options.notifications.test());
  return () => { ipcMain.removeHandler(NOTIFICATION_CHANNELS.get); ipcMain.removeHandler(NOTIFICATION_CHANNELS.test); };
}
