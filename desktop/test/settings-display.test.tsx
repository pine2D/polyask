import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { DisplayPreferences } from '../src/shared/display';
import { mountSettings, settingsElement } from './ui/settings-dom';

const radio = (doc: Document, name: string, value: string) => doc.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;

test('settings expose two independent display groups with only existing legal values', async () => {
  const h = await mountSettings({ display: { density: 'comfortable', siteScale: 1 }, onDisplayChange: async () => {} });
  try {
    const groups = h.document.querySelectorAll('fieldset');
    assert.equal(groups.length, 2, 'display and reading must expose density and default site scale');
    assert.deepEqual([...h.document.querySelectorAll<HTMLInputElement>('input[name="settings-density"]')].map(node => node.value), ['compact', 'comfortable']);
    assert.deepEqual([...h.document.querySelectorAll<HTMLInputElement>('input[name="settings-site-scale"]')].map(node => node.value), ['0.9', '1']);
    assert.equal(radio(h.document, 'settings-density', 'comfortable').checked, true);
    assert.equal(radio(h.document, 'settings-site-scale', '1').checked, true);
    assert.match(groups[0].textContent!, /app controls and spacing/);
    assert.match(groups[1].textContent!, /not zoomed manually.*Ctrl\+0/s);
  } finally { await h.close(); }
});

test('pending display save blocks duplicate intents and keeps accepted props visible on failure', async () => {
  let fail!: (error: Error) => void; const intents: DisplayPreferences[] = [];
  const h = await mountSettings({ display: { density: 'compact', siteScale: 0.9 },
    onDisplayChange: value => { intents.push(value); return new Promise((_, reject) => { fail = reject; }); } });
  try {
    assert.equal(h.document.querySelectorAll('fieldset').length, 2, 'display controls must exist before interaction');
    await act(async () => { radio(h.document, 'settings-density', 'comfortable').click(); radio(h.document, 'settings-site-scale', '1').click(); });
    assert.deepEqual(intents, [{ density: 'comfortable', siteScale: 0.9 }]);
    assert.equal(radio(h.document, 'settings-density', 'compact').checked, true);
    assert.equal(radio(h.document, 'settings-site-scale', '1').disabled, true);
    await act(async () => fail(Error('rejected')));
    assert.equal(radio(h.document, 'settings-density', 'compact').checked, true);
    assert.equal(radio(h.document, 'settings-site-scale', '1').disabled, false);
    assert.equal(h.document.querySelector('.settings-display [role="alert"]') === null, false);
  } finally { await h.close(); }
});

test('menu pushes while saving are displayed and the next field edit keeps the latest other field', async () => {
  let finish!: () => void; const intents: DisplayPreferences[] = [];
  const save = (value: DisplayPreferences) => { intents.push(value); return new Promise<void>(resolve => { finish = resolve; }); };
  const h = await mountSettings({ display: { density: 'compact', siteScale: 0.9 }, onDisplayChange: save });
  try {
    assert.equal(h.document.querySelectorAll('fieldset').length, 2, 'display controls must exist before interaction');
    await h.click(radio(h.document, 'settings-density', 'comfortable'));
    await h.render(settingsElement({ display: { density: 'comfortable', siteScale: 1 }, onDisplayChange: save }));
    await act(async () => finish());
    assert.equal(radio(h.document, 'settings-site-scale', '1').checked, true);
    await h.click(radio(h.document, 'settings-site-scale', '0.9'));
    assert.deepEqual(intents, [{ density: 'comfortable', siteScale: 0.9 }, { density: 'comfortable', siteScale: 0.9 }]);
    await act(async () => finish());
  } finally { await h.close(); }
});

test('fixtures without a save callback show disabled display controls', async () => {
  const h = await mountSettings();
  try {
    assert.equal(h.document.querySelectorAll('fieldset').length, 2, 'display controls must exist for older read-only fixtures');
    assert.equal([...h.document.querySelectorAll<HTMLInputElement>('.settings-display input')].every(node => node.disabled), true);
  } finally { await h.close(); }
});
