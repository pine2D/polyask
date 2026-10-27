import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { focusableControls } from '../src/renderer/focusable-controls';
import { mountSettings, settingsButton, settingsCopy, settingsElement, settingsShell, settingsStatus } from './ui/settings-dom';

const advanced = (doc: Document) => doc.querySelector<HTMLDetailsElement>('.settings-advanced')!;

test('category scrolling restores each position without changing the current category or focus', async () => {
  const h = await mountSettings();
  try {
    const body = h.document.querySelector<HTMLElement>('.settings-grid')!;
    assert.equal(body !== null, true);
    const navigate = async (category: string) => h.click(h.document.querySelector<HTMLElement>(`[data-settings-section=${category}]`)!);
    body.scrollTop = 100;
    await navigate('sync'); body.scrollTop = 370;
    await navigate('appearance'); assert.equal(body.scrollTop, 100);
    await navigate('sync'); assert.equal(body.scrollTop, 370);
    const focus = h.document.activeElement;
    await act(async () => { body.scrollTop = 900; body.dispatchEvent(new h.window.Event('scroll')); });
    assert.equal(h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section'), 'sync');
    assert.equal(h.document.activeElement === focus, true);
  } finally { await h.close(); }
});

test('explicit data requests reopen and focus the summary without background pushes stealing focus', async () => {
  const h = await mountSettings({ initialSection: 'data', sectionRequest: 1 });
  try {
    assert.equal(advanced(h.document) === null, false, 'data navigation must have an advanced section');
    const summary = advanced(h.document).querySelector('summary')!;
    assert.equal(advanced(h.document).open, true);
    assert.equal(h.document.activeElement === summary, true);
    await h.click(summary);
    assert.equal(advanced(h.document).open, false);
    const close = h.document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!;
    close.focus();
    await h.render(settingsElement({ initialSection: 'data', sectionRequest: 1, status: { ...settingsStatus, pending: 3 } }));
    assert.equal(advanced(h.document).open, false);
    assert.equal(h.document.activeElement === close, true);
    await h.render(settingsElement({ initialSection: 'data', sectionRequest: 2 }));
    assert.equal(advanced(h.document).open, true);
    assert.equal(h.document.activeElement === summary, true);
  } finally { await h.close(); }
});

test('folding advanced data keeps DELETE text and never starts cloud deletion', async () => {
  let clears = 0;
  const h = await mountSettings({ initialSection: 'data' });
  settingsShell({ clearRemoteSync: async () => { clears++; return settingsStatus; } });
  try {
    assert.equal(advanced(h.document) === null, false, 'advanced data must be collapsible');
    const input = h.document.querySelector<HTMLInputElement>('[name="clear-cloud-confirmation"]')!;
    await h.input(input, 'DELETE');
    await h.click(advanced(h.document).querySelector('summary')!);
    await h.click(advanced(h.document).querySelector('summary')!);
    assert.equal(input.value, 'DELETE');
    assert.equal(clears, 0);
  } finally { await h.close(); }
});

test('backup from a local confirmation cancels it and only focuses the existing export action', async () => {
  let exports = 0;
  const h = await mountSettings({ initialSection: 'data' });
  settingsShell({ exportBackup: async () => { exports++; return {}; } });
  try {
    await h.click(settingsButton(h.document, settingsCopy.clearHistoryAction));
    const backup = settingsButton(h.document, settingsCopy.localDataBackupFirst);
    assert.equal(backup === undefined, false, 'clear confirmation must offer the existing backup entry');
    await h.click(backup);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    const exportButton = h.document.querySelector<HTMLButtonElement>('[aria-labelledby="backup-card-title"] button')!;
    assert.equal(h.document.activeElement === exportButton, true);
    assert.equal(exports, 0);
  } finally { await h.close(); }
});

test('cloud deletion keeps advanced data open and prevents exit until its write settles', async () => {
  let finish!: () => void, closes = 0;
  const h = await mountSettings({ initialSection: 'data', onClose: () => { closes++; } });
  settingsShell({ clearRemoteSync: () => new Promise(resolve => { finish = () => resolve(settingsStatus); }) });
  try {
    assert.equal(advanced(h.document) === null, false, 'destructive write must stay visible in advanced data');
    await h.input(h.document.querySelector<HTMLInputElement>('[name="clear-cloud-confirmation"]')!, 'DELETE');
    await h.click(settingsButton(h.document, settingsCopy.syncClear));
    await h.click(advanced(h.document).querySelector('summary')!);
    assert.equal(advanced(h.document).open, true);
    assert.equal(h.document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.disabled, true);
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(closes, 0);
    await act(async () => finish());
    assert.equal(h.document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!.disabled, false);
  } finally { await h.close(); }
});

for (const [target, category, id] of [
  ['display', 'appearance', 'settings-display-title'], ['overview', 'sync', 'sync-title'],
  ['drive-diagnostics', 'sync', 'sync-diagnostics-toggle'], ['proxy', 'network', 'settings-proxy-title'],
  ['image-sync', 'sync', 'question-image-sync-title'], ['preference-sync', 'sync', 'settings-preference-sync-title']
] as const) test(`deep link ${target} selects its category and repeated requests still focus the exact target`, async () => {
  const props = { initialSection: target, sectionRequest: 1, preferenceSync: { snapshot: null,
    onFollowingChange: async () => {}, onLayoutModeChange: async () => {}, onDraftSyncChange: async () => {} } };
  const h = await mountSettings(props);
  try {
    assert.equal(h.document.querySelector('[data-settings-category]:not([hidden])')?.getAttribute('data-settings-category'), category);
    assert.equal(h.document.activeElement?.id, id);
    await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=about]')!);
    await h.render(settingsElement({ ...props, status: { ...settingsStatus, pending: 2 } }));
    assert.equal(h.document.activeElement?.id, 'settings-category-about', 'background push keeps the current category');
    await h.render(settingsElement({ ...props, sectionRequest: 2 }));
    assert.equal(h.document.activeElement?.id, id);
  } finally { await h.close(); }
});

test('requests during cloud deletion are ignored and do not replay after unlocking', async () => {
  let finish!: () => void;
  const h = await mountSettings({ initialSection: 'data', sectionRequest: 1 });
  settingsShell({ clearRemoteSync: () => new Promise(resolve => { finish = () => resolve(settingsStatus); }) });
  try {
    await h.input(h.document.querySelector<HTMLInputElement>('[name="clear-cloud-confirmation"]')!, 'DELETE');
    await h.click(settingsButton(h.document, settingsCopy.syncClear));
    assert.equal([...h.document.querySelectorAll<HTMLButtonElement>('[data-settings-section]')].every(button => button.disabled), true);
    assert.equal(h.document.querySelector<HTMLSelectElement>('.settings-category-select')!.disabled, true);
    await h.render(settingsElement({ initialSection: 'display', sectionRequest: 2 }));
    assert.equal(h.document.querySelector('[aria-current=location]')?.getAttribute('data-settings-section'), 'data');
    await act(async () => finish());
    assert.equal(h.document.querySelector('[aria-current=location]')?.getAttribute('data-settings-section'), 'data');
    await h.render(settingsElement({ initialSection: 'display', sectionRequest: 3 }));
    assert.equal(h.document.activeElement?.id, 'settings-display-title');
  } finally { await h.close(); }
});
