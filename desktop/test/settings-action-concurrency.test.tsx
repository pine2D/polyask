import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountSettings, settingsButton, settingsCopy, settingsShell, settingsStatus } from './ui/settings-dom';

for (const action of ['sync', 'connect', 'disconnect', 'update'] as const) {
  test(`${action}: settings ignore same-turn duplicates and recover after rejection`, async () => {
    const pending: { resolve: (value: typeof settingsStatus) => void; reject: () => void }[] = [];
    const perform = () => new Promise<typeof settingsStatus>((resolve, reject) => pending.push({ resolve, reject: () => reject(Error('fixture-failed')) }));
    const h = await mountSettings({ status: { ...settingsStatus, connected: action !== 'connect' },
      ...(action === 'update' ? { onCheckUpdates: async () => { await perform(); } } : {}) });
    settingsShell({ syncNow: perform, connectSync: perform, disconnectSync: perform });
    try {
      const label = action === 'sync' ? settingsCopy.syncNow : action === 'connect' ? settingsCopy.syncConnect
        : action === 'disconnect' ? settingsCopy.syncDisconnect : settingsCopy.checkForUpdates;
      const button = settingsButton(h.document, label);
      await act(async () => { for (let i = 0; i < 10; i++) button.click(); });
      assert.equal(pending.length, 1, 'one accepted action per in-flight operation');
      await act(async () => pending[0].reject());
      assert.equal(button.disabled, false);
      assert.equal(h.document.querySelector('.archive-status')!.textContent,
        action === 'update' ? settingsCopy.updatePageFailed : settingsCopy.syncActionFailed);
      await h.click(button);
      assert.equal(pending.length, 2, 'an explicit retry is accepted after failure');
      await act(async () => pending[1].resolve(settingsStatus));
    } finally {
      await act(async () => pending.forEach(item => item.resolve(settingsStatus)));
      await h.close();
    }
  });
}

for (const first of ['sync', 'update'] as const) {
  test(`${first}: a different settings action waits until the current operation settles`, async () => {
    const calls: string[] = [], finish: (() => void)[] = [];
    const perform = (kind: string) => {
      calls.push(kind);
      return new Promise<typeof settingsStatus>(resolve => finish.push(() => resolve(settingsStatus)));
    };
    const h = await mountSettings({ onCheckUpdates: async () => { await perform('update'); } });
    settingsShell({ syncNow: () => perform('sync'), disconnectSync: () => perform('disconnect') });
    try {
      const second = first === 'sync' ? 'update' : 'disconnect';
      const primary = settingsButton(h.document, first === 'sync' ? settingsCopy.syncNow : settingsCopy.checkForUpdates);
      const secondary = settingsButton(h.document, second === 'update' ? settingsCopy.checkForUpdates : settingsCopy.syncDisconnect);
      await act(async () => { primary.click(); secondary.click(); });
      assert.deepEqual(calls, [first]);
      await act(async () => finish[0]());
      await h.click(secondary);
      assert.deepEqual(calls, [first, second], 'the next action becomes available after completion');
      await act(async () => finish[1]());
    } finally {
      await act(async () => finish.forEach(resolve => resolve()));
      await h.close();
    }
  });
}
