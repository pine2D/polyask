import type { SiteKey } from './contracts';

/** Runtime feedback only; no OS error text, question content or persistent setting. */
export interface NotificationStatus {
  readonly state: 'idle' | 'requested' | 'shown' | 'unknown' | 'failed' | 'unsupported';
  readonly revision: number;
}
export interface NotificationTarget {
  readonly runId: string;
  readonly site: SiteKey;
  readonly questionId?: string;
  readonly answerId?: string;
}
export interface NotificationApi {
  getNotificationStatus(): Promise<NotificationStatus>;
  testNotification(): Promise<NotificationStatus>;
  onNotificationStatus(callback: (status: NotificationStatus) => void): () => void;
  onNotificationOpen(callback: (target: NotificationTarget | null) => void): () => void;
}
export const NOTIFICATION_CHANNELS = {
  get: 'polyask:notification-status', test: 'polyask:notification-test',
  status: 'polyask:notification-status-changed', open: 'polyask:notification-open'
} as const;
