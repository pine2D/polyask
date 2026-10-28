import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SettingsLayout } from '../src/renderer/settings-layout';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../src/shared/preferences';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';
import { mountSettings } from './ui/settings-dom';

const copy = getCopy('en');
const state: PreferenceSnapshot = { deviceId: 'layout-test', values: { ...DEFAULT_PREFERENCE_VALUES, layoutMode: 'focus' },
  following: { display: false, layout: true, siteZoom: false, proxy: false }, draftSync: false, initialized: [], versions: {} };
const radio = (doc: Document, value: string) => doc.querySelector<HTMLInputElement>(`input[name="settings-layout-mode"][value="${value}"]`)!;

test('layout starts in appearance and the sync shortcut focuses the single editor without writing', async () => {
  let writes = 0;
  const h = await mountSettings({ preferenceSync: { snapshot: state, onFollowingChange: async () => {},
    onLayoutModeChange: async () => { writes++; }, onDraftSyncChange: async () => {} } });
  try {
    assert.equal(radio(h.document, 'focus').closest('[data-settings-category]')?.getAttribute('data-settings-category'), 'appearance');
    assert.equal(radio(h.document, 'focus').checked, true);
    assert.equal(h.document.getElementById('settings-layout-scope')?.textContent, copy.preferenceSyncScopeShared);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-settings-section="sync"]')!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.settings-inline-action')!);
    assert.equal(h.document.activeElement?.id, 'settings-layout-title');
    assert.equal(h.document.querySelectorAll('[name="settings-layout-mode"]').length, 2);
    assert.equal(radio(h.document, 'focus').closest('[hidden],[inert]') === null, true);
    assert.equal(writes, 0, 'jumping from sync never edits accepted preferences');
  } finally { await h.close(); }
});

test('loading layout does not present a fallback as an accepted choice', async () => {
  const h = await mountDom(<SettingsLayout copy={copy} snapshot={null} busy={false} onLayoutModeChange={async () => {}} />);
  try {
    assert.equal(radio(h.document, 'overview').checked, false);
    assert.equal(radio(h.document, 'focus').checked, false);
    assert.equal(radio(h.document, 'overview').disabled, true);
    assert.equal(h.document.getElementById('settings-layout-scope')?.textContent, copy.preferenceSyncLoading);
  } finally { await h.close(); }
});

test('layout save blocks repeats, retains the accepted value on failure and can retry', async () => {
  let fail!: (error: Error) => void;
  const intents: string[] = [];
  const save = (mode: string) => { intents.push(mode); return new Promise<void>((_, reject) => { fail = reject; }); };
  const h = await mountDom(<SettingsLayout copy={copy} snapshot={state} busy={false} onLayoutModeChange={save} />);
  try {
    await act(async () => { radio(h.document, 'overview').click(); radio(h.document, 'overview').click(); });
    assert.deepEqual(intents, ['overview']);
    assert.equal(radio(h.document, 'focus').checked, true);
    assert.equal(radio(h.document, 'overview').disabled, true);
    await act(async () => fail(Error('save failed')));
    assert.equal(h.document.querySelector('[role="alert"]')?.textContent, copy.preferenceSyncFailed);
    assert.equal(radio(h.document, 'focus').checked, true);
    await h.click(radio(h.document, 'overview'));
    assert.deepEqual(intents, ['overview', 'overview']);
    await act(async () => fail(Error('save failed again')));
  } finally { await h.close(); }
});

test('accepted layout pushes remain authoritative while a save is pending', async () => {
  let finish!: () => void;
  const save = () => new Promise<void>(resolve => { finish = resolve; });
  const h = await mountDom(<SettingsLayout copy={copy} snapshot={state} busy={false} onLayoutModeChange={save} />);
  try {
    await h.click(radio(h.document, 'overview'));
    await h.render(<SettingsLayout copy={copy} snapshot={{ ...state, values: { ...state.values, layoutMode: 'overview' },
      following: { ...state.following, layout: false } }} busy={false} onLayoutModeChange={save} />);
    await act(async () => finish());
    assert.equal(radio(h.document, 'overview').checked, true);
    assert.equal(h.document.getElementById('settings-layout-scope')?.textContent, copy.preferenceSyncScopeLocal);
    assert.equal(radio(h.document, 'overview').disabled, false);
  } finally { await h.close(); }
});
