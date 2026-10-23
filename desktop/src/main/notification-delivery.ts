import type { NotificationStatus } from '../shared/notification';

type NativeEvent = 'show' | 'failed' | 'click' | 'close';
export interface NativeNotification {
  on(event: NativeEvent, listener: () => void): unknown;
  removeListener(event: NativeEvent, listener: () => void): unknown;
  show(): void;
  close(): void;
}
export interface NotificationMessage { readonly title: string; readonly body: string }
interface ActiveNotification {
  readonly notice: NativeNotification;
  readonly listeners: Record<NativeEvent, () => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Native errors are deliberately discarded at this boundary. */
export class NotificationDelivery {
  private sequence = 0;
  private disposed = false;
  private snapshot: NotificationStatus = { state: 'idle', revision: 0 };
  private readonly active = new Map<number, ActiveNotification>();
  constructor(private readonly options: {
    supported: () => boolean;
    create: (message: NotificationMessage) => NativeNotification;
    onStatus?: (status: NotificationStatus) => void;
  }) {}

  status(): NotificationStatus {
    if (!this.disposed && this.snapshot.state === 'idle') {
      try { if (!this.options.supported()) this.update('unsupported'); }
      catch { this.update('failed'); }
    }
    return { ...this.snapshot };
  }
  private update(state: NotificationStatus['state']): void {
    if (this.disposed) return;
    this.snapshot = { state, revision: this.snapshot.revision + 1 };
    try { this.options.onStatus?.(this.status()); } catch { /* Feedback must not break dispatch. */ }
  }
  private release(id: number, close = false): void {
    const active = this.active.get(id);
    if (!active) return;
    this.active.delete(id);
    if (active.timer) clearTimeout(active.timer);
    for (const [event, listener] of Object.entries(active.listeners)) active.notice.removeListener(event as NativeEvent, listener);
    if (close) { try { active.notice.close(); } catch { /* Already closed by the platform. */ } }
  }
  send(message: NotificationMessage, onClick?: () => void): NotificationStatus {
    if (this.disposed) return this.status();
    const id = ++this.sequence;
    try {
      if (!this.options.supported()) { this.update('unsupported'); return this.status(); }
      // Bound retained OS objects while keeping older notifications clickable.
      if (this.active.size >= 24) this.release(this.active.keys().next().value!, true);
      const notice = this.options.create(message);
      let clicked = false;
      const result = (state: NotificationStatus['state']): void => {
        const entry = this.active.get(id);
        if (!entry || this.disposed) return;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
        if (id === this.sequence) this.update(state);
      };
      const listeners: Record<NativeEvent, () => void> = {
        show: () => result('shown'),
        failed: () => { result('failed'); this.release(id, true); },
        click: () => {
          if (clicked || !this.active.has(id) || this.disposed) return;
          clicked = true;
          try { onClick?.(); } catch { /* A stale destination must not escape the event handler. */ }
        },
        close: () => { if (this.snapshot.state === 'requested') result('unknown'); this.release(id); }
      };
      this.active.set(id, { notice, listeners, timer: null });
      for (const [event, listener] of Object.entries(listeners)) notice.on(event as NativeEvent, listener);
      this.update('requested');
      this.active.get(id)!.timer = setTimeout(() => result('unknown'), 5_000);
      notice.show();
    } catch { this.release(id, true); this.update('failed'); }
    return this.status();
  }
  reset(): void {
    if (this.disposed) return;
    ++this.sequence;
    for (const id of this.active.keys()) this.release(id, true);
    this.update('idle');
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.sequence;
    for (const id of this.active.keys()) this.release(id, true);
  }
}
