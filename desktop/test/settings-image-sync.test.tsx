import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountSettings, settingsButton, settingsCopy, settingsShell, settingsStatus } from './ui/settings-dom';

test('image sync can be disabled through settings while manual sync is still pending', async () => {
  const calls: boolean[] = []; let finish!: () => void;
  const h = await mountSettings({status: {...settingsStatus, imageSyncEnabled:true} as typeof settingsStatus});
  settingsShell({syncNow: () => new Promise(resolve => { finish = () => resolve(settingsStatus); }),
    setImageSyncEnabled: async (value: boolean) => { calls.push(value); return {...settingsStatus,imageSyncEnabled:value}; }});
  try {
    await h.click(settingsButton(h.document, settingsCopy.syncNow));
    const input = h.document.querySelector<HTMLInputElement>('input[name="question-image-sync"]');
    assert.equal(input === null, false, 'settings must expose the image sync switch');
    assert.equal(input!.disabled, false, 'image cancellation is available during manual sync');
    await h.click(input!); assert.deepEqual(calls, [false]);
  } finally { await act(async () => finish?.()); await h.close(); }
});

test('first image enable requires scope and upgrade confirmation and preserves state on failure', async () => {
  const calls: boolean[] = [], announcements: string[] = [];
  const h = await mountSettings({onAnnounce: message => announcements.push(message)});
  settingsShell({setImageSyncEnabled: async (value: boolean) => { calls.push(value); throw new Error('failed'); }});
  try {
    const input = h.document.querySelector<HTMLInputElement>('input[name="question-image-sync"]');
    assert.equal(input === null, false);
    await h.click(input!); assert.equal(calls.length, 0);
    const message = h.document.querySelector('#confirm-message')?.textContent ?? '';
    assert.match(message, /Google Drive/); assert.match(message, /older versions/i); assert.match(message, /EXIF/);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.deepEqual(calls, [true]); assert.equal(input!.checked, false);
    assert.equal(announcements.length, 1);
  } finally { await h.close(); }
});
