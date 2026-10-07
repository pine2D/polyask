import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountSettings, settingsButton, settingsCopy, settingsShell, settingsStatus } from './ui/settings-dom';

const closeButton = (doc: Document) => doc.querySelector<HTMLButtonElement>('.settings-workspace .panel-close')!;
const confirmButton = (doc: Document) => doc.querySelector<HTMLButtonElement>('[data-local-confirm]')!;
const escape = async (h: Awaited<ReturnType<typeof mountSettings>>) => {
  await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
};

for (const action of ['clear', 'reset'] as const) for (const outcome of ['success', 'failure'] as const) {
  test(`local ${action} notifies the parent before writing and unlocks after ${outcome}`, async () => {
    let blocking = false, startedWithBlocking = false, closes = 0, resets = 0, finish!: () => void;
    const events: boolean[] = [];
    const h = await mountSettings({ initialSection: 'data', onBlockingChange: value => { blocking = value; events.push(value); },
      onClose: () => { closes++; }, onLocalReset: () => { resets++; } });
    settingsShell({ [action === 'reset' ? 'resetLocalData' : 'clearHistory']: () => {
      startedWithBlocking = blocking;
      return new Promise((resolve, reject) => { finish = () => outcome === 'failure' ? reject(Error('fixture-write-failed'))
        : resolve(action === 'reset' ? settingsStatus : 4); });
    } });
    try {
      await h.click(settingsButton(h.document, action === 'reset' ? settingsCopy.resetLocalAction : settingsCopy.clearHistoryAction));
      assert.equal(blocking, false, 'reading a confirmation snapshot must not block navigation');
      await h.click(confirmButton(h.document));
      assert.equal(startedWithBlocking, true, 'parent command gate must already be locked when IPC starts');
      assert.equal(closeButton(h.document).disabled, true);
      await h.click(closeButton(h.document)); await escape(h);
      assert.equal(closes, 0);
      await h.click(h.document.querySelector('.settings-advanced > summary')!);
      assert.equal(h.document.querySelector<HTMLDetailsElement>('.settings-advanced')!.open, true);
      await act(async () => finish());
      assert.equal(blocking, false);
      assert.equal(events.at(-1), false, 'settled writes release the parent command gate');
      assert.equal(closeButton(h.document).disabled, false);
      assert.equal(resets, action === 'reset' && outcome === 'success' ? 1 : 0);
      if (outcome === 'failure') assert.equal(confirmButton(h.document).disabled, false);
    } finally { await h.close(); }
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`cloud deletion notifies the parent before writing and unlocks after ${outcome}`, async () => {
    let blocking = false, startedWithBlocking = false, finish!: () => void;
    const events: boolean[] = [];
    const h = await mountSettings({ initialSection: 'data', onBlockingChange: value => { blocking = value; events.push(value); } });
    settingsShell({ clearRemoteSync: () => {
      startedWithBlocking = blocking;
      return new Promise((resolve, reject) => { finish = () => outcome === 'failure' ? reject(Error('fixture-cloud-failed')) : resolve(settingsStatus); });
    } });
    try {
      await h.input(h.document.querySelector<HTMLInputElement>('[name="clear-cloud-confirmation"]')!, 'DELETE');
      await h.click(settingsButton(h.document, settingsCopy.syncClear));
      assert.equal(startedWithBlocking, true, 'cloud IPC must not start before parent navigation is blocked');
      assert.equal(closeButton(h.document).disabled, true);
      await act(async () => finish());
      assert.equal(blocking, false);
      assert.equal(events.at(-1), false);
      assert.equal(closeButton(h.document).disabled, false);
    } finally { await h.close(); }
  });
}

test('slow statistics leave the settings page and parent navigation unlocked', async () => {
  let blocking = false, closes = 0;
  const h = await mountSettings({ initialSection: 'data', onBlockingChange: value => { blocking = value; }, onClose: () => { closes++; } });
  settingsShell({ getLocalDataStats: () => new Promise(() => {}) });
  try {
    await h.click(settingsButton(h.document, settingsCopy.clearHistoryAction));
    assert.equal(confirmButton(h.document).disabled, true);
    assert.equal(blocking, false);
    assert.equal(closeButton(h.document).disabled, false);
    await h.click(closeButton(h.document));
    assert.equal(closes, 1);
  } finally { await h.close(); }
});

test('waiting for browser authorization does not hold the parent navigation lock', async () => {
  let blocking = false, closes = 0;
  const h = await mountSettings({ onBlockingChange: value => { blocking = value; }, onClose: () => { closes++; },
    status: { ...settingsStatus, connected: false } });
  settingsShell({ connectSync: () => new Promise(() => {}) });
  try {
    await h.click(settingsButton(h.document, settingsCopy.syncConnect));
    assert.equal(blocking, false);
    assert.equal(closeButton(h.document).disabled, false);
    await escape(h);
    assert.equal(closes, 1);
  } finally { await h.close(); }
});
