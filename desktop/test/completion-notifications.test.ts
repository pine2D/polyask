import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { readSource } from './fixtures';
import { DesktopDatabase } from '../src/main/database';
import { QuestionHistoryService } from '../src/main/question-history-service';
import { CompletionNotifier } from '../src/main/completion-notifier';
import { NotificationDelivery } from '../src/main/notification-delivery';
import type { CompletionNotifications } from '../src/main/completion-notifications';
import * as copy from '../src/shared/copy';
import * as contract from '../src/shared/notification';
import { NOTIFICATION_COPY } from '../src/shared/notification-copy';
import type { SiteStatus } from '../src/shared/protocol';
import * as protocol from '../src/shared/protocol';

function fixture() {
  const db = DesktopDatabase.open(':memory:');
  const questions = new QuestionHistoryService(db.questions, { deviceId: () => 'device-notify' });
  const notices: Native[] = [], events: { channel: string; value: unknown }[] = [];
  let destroyed = false, restored = 0;
  class Native extends EventEmitter {
    closed = false;
    static isSupported(): boolean { return true; }
    constructor(readonly message: { title: string; body: string }) { super(); notices.push(this); }
    show(): void {}
    close(): void { this.closed = true; this.emit('close'); }
  }
  const exported = { exports: {} as { createCompletionNotifications: (options: unknown) => CompletionNotifications } };
  runInNewContext(transformSync(readSource('src/main/completion-notifications.ts'), { loader: 'ts', format: 'cjs' }).code, {
    module: exported, exports: exported.exports, require: (name: string) => {
      if (name === 'electron') return { Notification: Native };
      if (name === './completion-notifier') return { CompletionNotifier };
      if (name === './notification-delivery') return { NotificationDelivery };
      if (name === '../shared/copy') return copy;
      if (name === '../shared/notification') return contract;
      if (name === '../shared/protocol') return protocol;
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  const notifications = exported.exports.createCompletionNotifications({
    window: { isDestroyed: () => destroyed, isFocused: () => false, isMinimized: () => true,
      restore: () => { restored++; }, show() {}, focus() {}, webContents: { isDestroyed: () => destroyed } },
    copy: { ...copy.getCopy('en'), ...NOTIFICATION_COPY.en }, questions: () => questions,
    publish: (channel: string, value: unknown) => events.push({ channel, value })
  });
  const begin = (runId: string) => questions.begin({ runId, text: 'Private draft never shown in a notification', tier: null, sites: ['claude'], images: [] })!;
  const accept = (runId: string, phase: SiteStatus['phase']) => notifications.accept({ site: 'claude', phase,
    submission: { runId, state: phase === 'sending' ? 'sending' : 'sent' },
    ...(phase === 'complete' ? { generation: { runId, state: 'complete' } } : {}) }, 'Claude');
  return { db, questions, notifications, notices, events, begin, accept, restored: () => restored,
    destroy: () => { destroyed = true; }, close: () => { notifications.dispose(); db.close(); } };
}

for (const superseded of [false, true]) test(`assisted send failures open only their current site run (superseded=${superseded})`, t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    h.notifications.setEnabled(true);
    h.notifications.accept({ site: 'claude', phase: 'failed', operationRunId: 'synthesis-a', code: 'inject_failed' }, 'Claude');
    t.mock.timers.tick(1_000); assert.equal(h.notices.length, 1);
    if (superseded) h.notifications.accept({ site: 'claude', phase: 'sending', operationRunId: 'synthesis-b' }, 'Claude');
    h.notices[0].emit('click');
    const target = h.events.find(event => event.channel === contract.NOTIFICATION_CHANNELS.open)?.value as contract.NotificationTarget;
    if (superseded) assert.equal(target, null);
    else { assert.equal(target.runId, 'synthesis-a'); assert.equal(target.site, 'claude'); assert.equal(target.questionId, undefined); }
  } finally { h.close(); }
});

test('clicking an older notification reads its saved question without navigating a remote site', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    h.notifications.setEnabled(true);
    const first = h.begin('run-a'); h.accept('run-a', 'sending'); h.accept('run-a', 'complete'); t.mock.timers.tick(1_000);
    h.begin('run-b'); h.accept('run-b', 'sending');
    assert.equal(JSON.stringify(h.notices[0].message).includes('Private draft'), false);
    h.notices[0].emit('click');
    const target = h.events.find(event => event.channel === contract.NOTIFICATION_CHANNELS.open)?.value as contract.NotificationTarget;
    assert.equal(target.questionId, first.id); assert.equal(target.runId, 'run-a'); assert.equal(target.site, 'claude');
    assert.equal(h.restored(), 1);
  } finally { h.close(); }
});

test('deleted records and superseded site identities degrade to unavailable on click', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    h.notifications.setEnabled(true);
    const first = h.begin('run-a'); h.accept('run-a', 'complete'); t.mock.timers.tick(1_000);
    h.questions.delete(first.id); h.begin('run-b'); h.accept('run-b', 'sending');
    h.notices[0].emit('click');
    assert.equal(h.events.find(event => event.channel === contract.NOTIFICATION_CHANNELS.open)?.value, null);
  } finally { h.close(); }
});

test('reset while notifications are disabled cancels explicit tests and every late native callback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    assert.equal(h.notifications.test().state, 'requested');
    h.notifications.reset();
    h.notices[0].emit('show'); h.notices[0].emit('failed', {}, 'private OS error'); h.notices[0].emit('click');
    t.mock.timers.tick(10_000);
    assert.equal(h.notifications.status().state, 'idle'); assert.equal(h.notices[0].closed, true);
    assert.equal(h.events.filter(event => event.channel === contract.NOTIFICATION_CHANNELS.open).length, 0);
    h.begin('run-a'); h.accept('run-a', 'complete'); t.mock.timers.tick(1_000); assert.equal(h.notices.length, 1);
    h.destroy(); h.notifications.test(); assert.equal(h.notices.length, 1);
  } finally { h.close(); }
});

test('repository lifecycle invalidation rejects old saved identities even while site status lingers', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture();
  try {
    h.notifications.setEnabled(true); h.begin('run-a'); h.accept('run-a', 'complete'); t.mock.timers.tick(1_000);
    h.db.questions.invalidateLifecycle(); h.notices[0].emit('click');
    assert.equal(h.events.find(event => event.channel === contract.NOTIFICATION_CHANNELS.open)?.value, null);
  } finally { h.close(); }
});
