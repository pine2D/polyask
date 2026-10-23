import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationNavigation } from '../src/renderer/use-notification-navigation';
import { registerDecisionNavigationGuard } from '../src/renderer/decision-navigation';
import { NOTIFICATION_COPY } from '../src/shared/notification-copy';

test('notification clicks preserve busy and unsaved navigation guards without changing drafts or sending', () => {
  const opened: string[] = [], feedback: string[] = []; let blocked = true, allow!: () => void;
  const navigation = createNotificationNavigation({ copy: NOTIFICATION_COPY.en, blocked: () => blocked,
    canOpenSite: () => true, onOpenQuestion: target => opened.push(target.questionId!),
    onOpenSite: site => opened.push(site), onAnnounce: message => feedback.push(message) });
  const target = { runId: 'run-a', site: 'claude', questionId: 'question-a', answerId: 'answer-a' } as const;
  navigation.accept(target); assert.equal(opened.length, 0); assert.equal(feedback.length, 1);
  blocked = false;
  const release = registerDecisionNavigationGuard(action => { allow = action; });
  try {
    navigation.accept(target); assert.equal(opened.length, 0);
    allow(); assert.deepEqual(opened, ['question-a']);
    navigation.accept(target); blocked = true; allow(); assert.equal(opened.length, 1);
  } finally { release(); navigation.dispose(); }
});

test('stale site identities, malformed targets and late approval after disposal cannot navigate', () => {
  let available = false, opened = 0, rejected = 0, approve!: () => void;
  const navigation = createNotificationNavigation({ copy: NOTIFICATION_COPY.en, blocked: () => false,
    canOpenSite: target => available && target.runId === 'run-a', onOpenQuestion: () => { opened++; },
    onOpenSite: () => { opened++; }, onAnnounce: () => { rejected++; } });
  navigation.accept({ runId: 'old-run', site: 'claude' });
  navigation.accept({ runId: 'run-a', site: 'claude', questionId: '', answerId: 'bad' });
  navigation.accept(null); assert.equal(opened, 0); assert.equal(rejected, 3);
  available = true; navigation.accept({ runId: 'run-a', site: 'claude' }); assert.equal(opened, 1);
  const release = registerDecisionNavigationGuard(action => { approve = action; });
  try {
    navigation.accept({ runId: 'run-a', site: 'claude', questionId: 'question-a' });
    navigation.dispose(); approve(); assert.equal(opened, 1);
  } finally { release(); }
});
