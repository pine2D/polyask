import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PreferenceGroup, PreferenceSnapshot } from '../src/shared/preferences';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';
import { mountSettings } from './ui/settings-dom';

const state: PreferenceSnapshot = {
  values: { completionNotifications: false, display: { density: 'compact', siteScale: 0.9 },
    layoutMode: 'focus', siteZoom: {}, workbenchGuide: null },
  following: { display: false, layout: true, siteZoom: false }, draftSync: false,
  initialized: [], versions: {}, deviceId: 'fixture'
};

test('each preference group names the accepted value, current source and edit scope', async () => {
  const { PreferenceSyncSettings } = await import('../src/renderer/preference-sync-settings');
  const h = await mountDom(<PreferenceSyncSettings copy={getCopy('en')} snapshot={state} busy={false}
    onFollowingChange={async () => {}} onLayoutModeChange={async () => {}} onDraftSyncChange={async () => {}} />);
  try {
    assert.equal(h.document.querySelector('[data-preference-group="display"]') === null, false);
    assert.match(h.document.querySelector('[data-preference-group="display"] [data-preference-current]')!.textContent!, /Compact.*90%/);
    assert.match(h.document.querySelector('[data-preference-group="display"] [data-preference-scope]')!.textContent!, /this device/i);
    assert.match(h.document.querySelector('[data-preference-group="layout"] [data-preference-current]')!.textContent!, /Focus/);
    assert.match(h.document.querySelector('[data-preference-group="layout"] [data-preference-source]')!.textContent!, /shared/i);
    assert.match(h.document.querySelector('[data-preference-group="layout"] [data-preference-scope]')!.textContent!, /devices that follow/i);
    const legends = [...h.document.querySelectorAll('legend')].map(node => node.textContent);
    assert.equal(new Set(legends).size, legends.length, 'follow-source and layout-value controls need distinct legends');
  } finally { await h.close(); }
});

test('preferences do not present defaults as accepted values while their snapshot is loading', async () => {
  const { PreferenceSyncSettings } = await import('../src/renderer/preference-sync-settings');
  const copy = getCopy('en');
  const h = await mountDom(<PreferenceSyncSettings copy={copy} snapshot={null} busy={false}
    onFollowingChange={async () => {}} onLayoutModeChange={async () => {}} onDraftSyncChange={async () => {}} />);
  try {
    for (const value of h.document.querySelectorAll('[data-preference-current]')) assert.equal(value.textContent, copy.preferenceSyncLoading);
    assert.equal([...h.document.querySelectorAll<HTMLInputElement>('input')].every(input => input.disabled), true);
  } finally { await h.close(); }
});

test('preference settings expose device-follow choices layout mode and opt-in draft sync', async () => {
  const { PreferenceSyncSettings } = await import('../src/renderer/preference-sync-settings');
  const { PREFERENCE_SYNC_COPY } = await import('../src/shared/preference-sync-copy');
  const actions: unknown[] = [];
  const h = await mountDom(<PreferenceSyncSettings copy={{ ...getCopy('en'), ...PREFERENCE_SYNC_COPY.en }} snapshot={state} busy={false}
    onFollowingChange={async (group, following) => { actions.push([group, following]); }}
    onLayoutModeChange={async mode => { actions.push(mode); }} onDraftSyncChange={async enabled => { actions.push(enabled); }} />);
  try {
    for (const group of ['display', 'layout', 'siteZoom'] as PreferenceGroup[]) {
      assert.equal(h.document.querySelectorAll(`input[name="settings-follow-${group}"]`).length, 2);
    }
    assert.equal(h.document.querySelector<HTMLInputElement>('input[name="settings-follow-layout"][value="shared"]')!.checked, true);
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="settings-follow-display"][value="shared"]')!);
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="settings-layout-mode"][value="overview"]')!);
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="draft-sync"]')!);
    assert.deepEqual(actions, [['display', true], 'overview', true]);
    assert.match(h.document.querySelector('[data-draft-sync-description]')!.textContent!, /restor|cop/i);
  } finally { await h.close(); }
});

test('pending preference update blocks duplicates and leaves accepted selections visible on failure', async () => {
  const { PreferenceSyncSettings } = await import('../src/renderer/preference-sync-settings');
  const { PREFERENCE_SYNC_COPY } = await import('../src/shared/preference-sync-copy');
  let reject!: (error: Error) => void, changes = 0;
  const h = await mountDom(<PreferenceSyncSettings copy={{ ...getCopy('en'), ...PREFERENCE_SYNC_COPY.en }} snapshot={state} busy={false}
    onFollowingChange={() => { changes++; return new Promise((_, failed) => { reject = failed; }); }}
    onLayoutModeChange={async () => { changes++; }} onDraftSyncChange={async () => { changes++; }} />);
  try {
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="settings-follow-display"][value="shared"]')!);
    await h.click(h.document.querySelector<HTMLInputElement>('input[name="draft-sync"]')!);
    assert.equal(changes, 1);
    assert.equal(h.document.querySelector<HTMLInputElement>('input[name="settings-follow-display"][value="local"]')!.checked, true);
    await act(async () => reject(Error('failed')));
    assert.equal(h.document.querySelector('[role="alert"]') === null, false);
    assert.equal(h.document.querySelector<HTMLInputElement>('input[name="draft-sync"]')!.disabled, false);
  } finally { await h.close(); }
});

test('settings workspace includes shared preferences and describes notifications as shared', async () => {
  const { PREFERENCE_SYNC_COPY } = await import('../src/shared/preference-sync-copy');
  const h = await mountSettings({ copy: { ...getCopy('en'), ...PREFERENCE_SYNC_COPY.en },
    preferenceSync: { snapshot: state, onFollowingChange: async () => {}, onLayoutModeChange: async () => {}, onDraftSyncChange: async () => {} } });
  try {
    assert.equal(h.document.getElementById('settings-preference-sync-title') === null, false);
    assert.match(h.document.querySelector('label.preference-card small')!.textContent!, /shared/i);
  } finally { await h.close(); }
});
