import React, { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { NotificationApi, NotificationStatus } from '../shared/notification';
import type { NotificationCopy } from '../shared/notification-copy';
import { shell } from './shell-api';

type SettingsCopy = NotificationCopy & Pick<DesktopCopy, 'completionNotifications' | 'completionNotificationsDescription'>;
export function notificationStatusText(copy: NotificationCopy, status: NotificationStatus): string {
  const messages: Record<NotificationStatus['state'], string> = { idle: copy.notificationIdle,
    requested: copy.notificationRequested, shown: copy.notificationShown, unknown: copy.notificationUnknown,
    failed: copy.notificationFailed, unsupported: copy.notificationUnsupported };
  return messages[status.state] ?? copy.notificationFailed;
}
export function NotificationSettings(props: {
  readonly copy: SettingsCopy;
  readonly enabled: boolean;
  readonly busy?: boolean;
  readonly preferenceHint: string;
  readonly onChange?: (enabled: boolean) => void;
  readonly onAnnounce: (message: string) => void;
  readonly api?: Pick<NotificationApi, 'getNotificationStatus' | 'testNotification' | 'onNotificationStatus'>;
}): React.JSX.Element {
  const api = props.api ?? shell;
  const [status, setStatus] = useState<NotificationStatus>({ state: 'idle', revision: 0 });
  const [testing, setTesting] = useState(false);
  const mounted = useRef(false), inFlight = useRef(false), lifecycle = useRef(0), latestRevision = useRef(0);
  const testButton = useRef<HTMLButtonElement>(null), focusAfter = useRef<HTMLButtonElement | null>(null);
  const wantsFeedback = useRef(false), announcedRevision = useRef(-1), currentProps = useRef(props);
  currentProps.current = props;
  const accept = (next: NotificationStatus): boolean => {
    if (!mounted.current || !next || !Number.isSafeInteger(next.revision) || next.revision < latestRevision.current) return false;
    latestRevision.current = next.revision; setStatus(next); return true;
  };
  const report = (next: NotificationStatus): void => {
    if (!accept(next) || !wantsFeedback.current || next.revision <= announcedRevision.current) return;
    announcedRevision.current = next.revision;
    currentProps.current.onAnnounce(notificationStatusText(currentProps.current.copy, next));
    if (next.state !== 'requested') wantsFeedback.current = false;
  };
  useEffect(() => {
    const current = ++lifecycle.current; mounted.current = true;
    let unsubscribe = () => {};
    const initialRevision = latestRevision.current;
    const active = (): boolean => mounted.current && lifecycle.current === current;
    const fail = (): void => { if (active() && latestRevision.current === initialRevision) setStatus(previous => ({ ...previous, state: 'failed' })); };
    try {
      unsubscribe = api.onNotificationStatus(next => { if (active()) report(next); });
      void api.getNotificationStatus().then(next => { if (active()) accept(next); }).catch(fail);
    } catch { fail(); }
    return () => { lifecycle.current++; mounted.current = false; focusAfter.current = null; unsubscribe(); };
  }, [api]);
  useEffect(() => {
    if (testing || props.busy || status.state === 'requested' || !focusAfter.current) return;
    const target = focusAfter.current; focusAfter.current = null;
    // Disabling the native button moves focus to body; an intentional move elsewhere wins.
    if (target.isConnected && (document.activeElement === document.body || document.activeElement === target)) target.focus();
  }, [testing, status.state, props.busy]);
  const testNotification = async (): Promise<void> => {
    if (props.busy || inFlight.current || status.state === 'requested') return;
    const current = lifecycle.current, initialRevision = latestRevision.current;
    focusAfter.current = testButton.current;
    wantsFeedback.current = true;
    inFlight.current = true; setTesting(true);
    try {
      const result = await api.testNotification();
      if (mounted.current && lifecycle.current === current) report(result);
    } catch {
      if (mounted.current && lifecycle.current === current && latestRevision.current === initialRevision) {
        wantsFeedback.current = false;
        setStatus(previous => ({ ...previous, state: 'failed' })); props.onAnnounce(props.copy.notificationFailed);
      }
    } finally { inFlight.current = false; if (mounted.current && lifecycle.current === current) setTesting(false); }
  };
  return <section className="settings-card" aria-labelledby="completion-notifications-title">
    <label className="preference-card">
      <span className="preference-copy">
        <strong id="completion-notifications-title" className="preference-title">{props.copy.completionNotifications}</strong>
        <p>{props.copy.completionNotificationsDescription}</p><small>{props.preferenceHint}</small>
      </span>
      <span className="preference-switch">
        <input type="checkbox" name="completion-notifications" aria-labelledby="completion-notifications-title"
          checked={props.enabled} disabled={props.busy} onChange={event => props.onChange?.(event.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
    <div className="settings-actions">
      <button ref={testButton} type="button" className="settings-control" disabled={props.busy || testing || status.state === 'requested'}
        aria-describedby="notification-test-status notification-test-hint" onClick={() => { void testNotification(); }}>{props.copy.notificationTest}</button>
    </div>
    <p id="notification-test-status" className="settings-control-hint">{notificationStatusText(props.copy, status)}</p>
    <small id="notification-test-hint">{props.copy.notificationTestHint}</small>
  </section>;
}
