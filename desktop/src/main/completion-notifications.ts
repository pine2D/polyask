import { Notification, type BrowserWindow } from 'electron';
import type { DesktopCopy } from '../shared/copy';
import { formatCopy } from '../shared/copy';
import type { NotificationCopy } from '../shared/notification-copy';
import { NOTIFICATION_CHANNELS, type NotificationTarget } from '../shared/notification';
import type { SiteKey } from '../shared/contracts';
import { siteStatusRunId, type SiteStatus } from '../shared/protocol';
import { CompletionNotifier } from './completion-notifier';
import { NotificationDelivery } from './notification-delivery';
import type { QuestionHistoryService } from './question-history-service';

interface Destination { readonly target: NotificationTarget; readonly lifecycle: number }
export function createCompletionNotifications(options: {
  window: BrowserWindow;
  copy: Pick<DesktopCopy, 'appTitle' | 'completionNotificationComplete'> & NotificationCopy;
  questions: () => QuestionHistoryService | null;
  publish: (channel: string, value: unknown) => void;
}) {
  let enabled = false, disposed = false;
  const latest = new Map<SiteKey, SiteStatus>();
  const destinations = new Map<string, Destination>();
  const alive = (): boolean => !disposed && !options.window.isDestroyed() && !options.window.webContents.isDestroyed();
  const publish = (channel: string, value: unknown): void => { if (alive()) options.publish(channel, value); };
  const restore = (): boolean => {
    if (!alive()) return false;
    if (options.window.isMinimized()) options.window.restore();
    options.window.show(); options.window.focus();
    return true;
  };
  const delivery = new NotificationDelivery({ supported: () => Notification.isSupported(),
    create: message => new Notification({ ...message, silent: true }),
    onStatus: status => publish(NOTIFICATION_CHANNELS.status, status) });
  const destinationKey = (runId: string, site: SiteKey): string => JSON.stringify([runId, site]);
  const remember = (status: SiteStatus): void => {
    const runId = siteStatusRunId(status);
    if (!runId) return;
    try {
      const questions = options.questions(), progress = questions?.getRunProgress(runId);
      if (!questions || progress?.state !== 'available' || !progress.questionId) return;
      const answer = progress.answers.filter(item => item.site === status.site).sort((a, b) => b.attempt - a.attempt)[0];
      if (!answer) return;
      const key = destinationKey(runId, status.site);
      destinations.delete(key);
      destinations.set(key, { lifecycle: questions.repository.lifecycle,
        target: { runId, site: status.site, questionId: progress.questionId, answerId: answer.id } });
      if (destinations.size > 64) destinations.delete(destinations.keys().next().value!);
    } catch { /* History persistence cannot block notifications or dispatch. */ }
  };
  const destination = (saved: Destination | undefined, runId: string, site: SiteKey): NotificationTarget | null => {
    try {
      const questions = options.questions();
      if (saved && questions) {
        if (saved.lifecycle !== questions.repository.lifecycle) return null;
        const question = questions.repository.get(saved.target.questionId!);
        const answer = questions.repository.getAnswer(saved.target.answerId!);
        if (question && !('deletedAt' in question) && answer && !('deletedAt' in answer)
          && answer.questionId === question.id && answer.site === site) return saved.target;
      }
    } catch { return null; }
    const current = latest.get(site);
    return siteStatusRunId(current) === runId ? { runId, site } : null;
  };
  const notifier = new CompletionNotifier({ copy: { title: options.copy.appTitle,
    complete: site => formatCopy(options.copy.completionNotificationComplete, { site }),
    failed: site => formatCopy(options.copy.notificationAttention, { site }),
    summary: (complete, failed) => formatCopy(options.copy.notificationSummary, { complete, failed }) },
    focused: () => !alive() || options.window.isFocused(),
    show: notice => {
      if (!alive()) return;
      const site = notice.sites[0], saved = destinations.get(destinationKey(notice.runId, site));
      delivery.send({ title: notice.title, body: notice.body }, () => {
        if (restore()) publish(NOTIFICATION_CHANNELS.open, destination(saved, notice.runId, site));
      });
    }
  });
  return {
    accept(status: SiteStatus, label: string): boolean {
      if (!alive()) return false;
      const accepted = notifier.accept(status, label);
      const runId = siteStatusRunId(status);
      if (!runId || notifier.currentRun(status.site) === runId) { latest.set(status.site, status); remember(status); }
      return accepted;
    },
    setEnabled(value: boolean): void {
      if (disposed || value === enabled) return;
      enabled = value; notifier.setEnabled(value);
      if (!value) delivery.reset();
    },
    status: () => delivery.status(),
    test: () => alive() ? delivery.send({ title: options.copy.appTitle, body: options.copy.notificationTestBody }, () => { restore(); }) : delivery.status(),
    reset(): void { enabled = false; notifier.reset(); delivery.reset(); latest.clear(); destinations.clear(); },
    dispose(): void { disposed = true; notifier.dispose(); delivery.dispose(); latest.clear(); destinations.clear(); }
  };
}
export type CompletionNotifications = ReturnType<typeof createCompletionNotifications>;
