import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { mountDom } from './ui/dom-harness';
import { NotificationSettings } from '../src/renderer/notification-settings';
import { getCopy } from '../src/shared/copy';
import { NOTIFICATION_COPY } from '../src/shared/notification-copy';
import type { NotificationStatus } from '../src/shared/notification';

test('testing notifications preserves the opt-in switch and shows only finite delivery feedback', async () => {
  const changes: boolean[] = [], announcements: string[] = [];
  let push!: (status: NotificationStatus) => void, released = false;
  const copy = { ...getCopy('en'), ...NOTIFICATION_COPY.en };
  const h = await mountDom(<NotificationSettings copy={copy} enabled={false} preferenceHint="Local setting"
    onChange={value => changes.push(value)} onAnnounce={value => announcements.push(value)} api={{
      getNotificationStatus: async () => ({ state: 'idle', revision: 0 }),
      onNotificationStatus: callback => { push = callback; return () => { released = true; }; },
      testNotification: async () => ({ state: 'requested', revision: 1 })
    }} />);
  try {
    const button = h.document.querySelector<HTMLButtonElement>('button')!;
    await h.click(button);
    assert.equal(changes.length, 0);
    assert.equal(h.document.querySelector<HTMLInputElement>('input')!.checked, false);
    assert.equal(button.disabled, true);
    assert.equal(h.document.querySelector('#notification-test-status')!.textContent, copy.notificationRequested);
    await act(async () => push({ state: 'failed', revision: 2 }));
    assert.equal(button.disabled, false);
    assert.equal(h.document.querySelector('#notification-test-status')!.textContent, copy.notificationFailed);
    assert.deepEqual(announcements, [copy.notificationRequested, copy.notificationFailed]);
  } finally { await h.close(); }
  assert.equal(released, true);
});

test('newer native feedback wins over a delayed test response and an old initial read', async () => {
  const copy = { ...getCopy('en'), ...NOTIFICATION_COPY.en };
  let push!: (status: NotificationStatus) => void, finishTest!: (status: NotificationStatus) => void, finishRead!: (status: NotificationStatus) => void;
  const announcements: string[] = [];
  const h = await mountDom(<NotificationSettings copy={copy} enabled={true} preferenceHint="Following preferences"
    onAnnounce={value => announcements.push(value)} api={{
      getNotificationStatus: () => new Promise(resolve => { finishRead = resolve; }),
      onNotificationStatus: callback => { push = callback; return () => {}; },
      testNotification: () => new Promise(resolve => { finishTest = resolve; })
    }} />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('button')!);
    await act(async () => { push({ state: 'failed', revision: 3 }); finishTest({ state: 'requested', revision: 2 }); finishRead({ state: 'idle', revision: 0 }); });
    assert.equal(h.document.querySelector('#notification-test-status')!.textContent, copy.notificationFailed);
    assert.deepEqual(announcements, [copy.notificationFailed]);
  } finally { await h.close(); }
});

test('notification test restores native focus after a terminal result without overriding an intentional move', async () => {
  let push!: (status: NotificationStatus) => void;
  const copy = { ...getCopy('en'), ...NOTIFICATION_COPY.en };
  let revision = 0;
  const h = await mountDom(<NotificationSettings copy={copy} enabled preferenceHint="Local setting" onAnnounce={() => {}} api={{
    getNotificationStatus: async () => ({ state: 'idle', revision: 0 }),
    onNotificationStatus: callback => { push = callback; return () => {}; },
    testNotification: async () => ({ state: 'requested', revision: ++revision })
  }} />);
  try {
    const button = h.document.querySelector<HTMLButtonElement>('button')!;
    button.focus(); await h.click(button);
    h.document.body.tabIndex = -1; h.document.body.focus();
    await act(async () => push({ state: 'failed', revision: ++revision }));
    assert.equal(h.document.activeElement === button, true);
    await h.click(button);
    const toggle = h.document.querySelector<HTMLInputElement>('input')!; toggle.focus();
    await act(async () => push({ state: 'shown', revision: ++revision }));
    assert.equal(h.document.activeElement === toggle, true);
  } finally { await h.close(); }
});

test('notification translations retain every placeholder and finite state explanation', () => {
  const placeholders = (value: string) => [...value.matchAll(/\{\w+\}/g)].map(item => item[0]).sort();
  for (const locale of ['zhCN', 'zhTW'] as const) {
    assert.deepEqual(Object.keys(NOTIFICATION_COPY[locale]).sort(), Object.keys(NOTIFICATION_COPY.en).sort());
    for (const key of Object.keys(NOTIFICATION_COPY.en) as (keyof typeof NOTIFICATION_COPY.en)[])
      assert.deepEqual(placeholders(NOTIFICATION_COPY[locale][key]), placeholders(NOTIFICATION_COPY.en[key]));
  }
});
