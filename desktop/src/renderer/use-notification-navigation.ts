import { useEffect, useRef } from 'react';
import { SITE_KEYS, type SiteKey } from '../shared/contracts';
import type { NotificationApi, NotificationTarget } from '../shared/notification';
import type { NotificationCopy } from '../shared/notification-copy';
import { questionIdValid } from '../shared/question-history';
import { requestDecisionNavigation } from './decision-navigation';
import { shell } from './shell-api';
import { externalNavigationBlocked } from './external-navigation-lock';

interface NotificationNavigationOptions {
  readonly copy: Pick<NotificationCopy, 'notificationOpenBlocked' | 'notificationOpenUnavailable'>;
  readonly blocked: () => boolean;
  readonly canOpenSite: (target: NotificationTarget) => boolean;
  readonly onOpenQuestion: (target: NotificationTarget & { questionId: string }) => void;
  readonly onOpenSite: (site: SiteKey) => void;
  readonly onAnnounce: (message: string) => void;
}
function validTarget(target: NotificationTarget | null): target is NotificationTarget {
  return !!target && questionIdValid(target.runId) && SITE_KEYS.includes(target.site)
    && (target.questionId === undefined || questionIdValid(target.questionId))
    && (target.answerId === undefined || (!!target.questionId && questionIdValid(target.answerId)));
}
export function createNotificationNavigation(options: NotificationNavigationOptions) {
  let disposed = false, revision = 0;
  return {
    accept(target: NotificationTarget | null): void {
      if (disposed) return;
      if (externalNavigationBlocked() || options.blocked()) { options.onAnnounce(options.copy.notificationOpenBlocked); return; }
      if (!validTarget(target)) { options.onAnnounce(options.copy.notificationOpenUnavailable); return; }
      const current = ++revision;
      requestDecisionNavigation(() => {
        if (disposed || current !== revision) return;
        if (options.blocked()) { options.onAnnounce(options.copy.notificationOpenBlocked); return; }
        if (target.questionId) options.onOpenQuestion({ ...target, questionId: target.questionId });
        else if (options.canOpenSite(target)) options.onOpenSite(target.site);
        else options.onAnnounce(options.copy.notificationOpenUnavailable);
      }, { kind: 'surface', surface: 'sites' });
    },
    dispose(): void { disposed = true; revision++; }
  };
}
export function useNotificationNavigation(options: NotificationNavigationOptions & {
  readonly api?: Pick<NotificationApi, 'onNotificationOpen'>;
}): void {
  const current = useRef(options); current.current = options;
  useEffect(() => {
    const api = options.api ?? shell;
    if (typeof api.onNotificationOpen !== 'function') return;
    const navigation = createNotificationNavigation({
      get copy() { return current.current.copy; },
      blocked: () => current.current.blocked(), canOpenSite: target => current.current.canOpenSite(target),
      onOpenQuestion: target => current.current.onOpenQuestion(target),
      onOpenSite: site => current.current.onOpenSite(site), onAnnounce: message => current.current.onAnnounce(message)
    });
    const unsubscribe = api.onNotificationOpen(target => navigation.accept(target));
    return () => { navigation.dispose(); unsubscribe(); };
  }, [options.api]);
}
