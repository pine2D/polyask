import type { GlobalPromptShortcutState } from '../../src/shared/global-prompt-shortcut';
import type { NotificationStatus } from '../../src/shared/notification';

/** Synthetic boundaries for the complete settings page; never registers OS shortcuts or notifications. */
export function desktopToolsShellStubs() {
  let shortcut: GlobalPromptShortcutState = { accelerator: null, activeAccelerator: null, status: 'disabled', error: null };
  let notification: NotificationStatus = { state: 'idle', revision: 0 };
  const listeners = new Set<(value: NotificationStatus) => void>();
  document.addEventListener('fixture:notification-result', event => {
    const state = (event as CustomEvent).detail;
    if (!['shown', 'unknown', 'failed', 'unsupported'].includes(state)) return;
    notification = { state, revision: notification.revision + 1 };
    for (const listener of listeners) listener(notification);
  });
  return {
    globalPromptShortcutState: async () => shortcut,
    setGlobalPromptShortcut: async (accelerator: string | null) => {
      document.body.dataset.shortcutWrites = String(Number(document.body.dataset.shortcutWrites ?? 0) + 1);
      if (document.body.dataset.shortcutPending === 'true') {
        await new Promise<void>(resolve => document.addEventListener('fixture:finish-shortcut', () => resolve(), { once: true }));
      }
      if (document.body.dataset.shortcutConflict === 'true') return { ...shortcut, error: 'conflict' as const };
      shortcut = { accelerator, activeAccelerator: accelerator, status: accelerator ? 'registered' : 'disabled', error: null };
      document.body.dataset.shortcutValue = accelerator ?? '';
      return shortcut;
    },
    getNotificationStatus: async () => notification,
    testNotification: async () => {
      document.body.dataset.notificationTests = String(Number(document.body.dataset.notificationTests ?? 0) + 1);
      notification = { state: 'requested', revision: notification.revision + 1 };
      for (const listener of listeners) listener(notification);
      return notification;
    },
    onNotificationStatus: (listener: (value: NotificationStatus) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    onNotificationOpen: () => () => {}
  };
}
