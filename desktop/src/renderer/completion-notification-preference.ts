export const COMPLETION_NOTIFICATIONS_KEY = "polyask.desktop.completion-notifications.v1";

export function saveCompletionNotifications(storage: Storage, enabled: boolean): boolean {
  try { storage.setItem(COMPLETION_NOTIFICATIONS_KEY, String(enabled)); return true; }
  catch { return false; }
}
