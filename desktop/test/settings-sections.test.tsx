import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { focusableControls } from '../src/renderer/focusable-controls';
import { mountSettings, settingsButton, settingsCopy, settingsElement, settingsShell, settingsStatus } from './ui/settings-dom';

const advanced = (doc: Document) => doc.querySelector<HTMLDetailsElement>('.settings-advanced')!;

test('in-page section navigation opens data and focuses headings without running actions', async () => {
  const h = await mountSettings();
  let clears = 0;
  settingsShell({ clearRemoteSync: async () => { clears++; return settingsStatus; } });
  try {
    const data = h.document.querySelector<HTMLButtonElement>('[data-settings-section="data"]');
    assert.equal(data === null, false, 'settings sections must be reachable without command shortcuts');
    await h.click(data!);
    assert.equal(data!.getAttribute('aria-current'), 'location');
    assert.equal(advanced(h.document).open, true);
    assert.equal(h.document.activeElement === h.document.getElementById('settings-advanced-toggle'), true);
    // R25：<summary> 本身可聚焦，跳转后不能被设成 tabIndex=-1 而退出 Tab 顺序。
    assert.equal(h.document.getElementById('settings-advanced-toggle')!.hasAttribute('tabindex'), false);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-settings-section="display"]')!);
    assert.equal(h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section'), 'display');
    assert.equal(h.document.activeElement === h.document.getElementById('settings-display-title'), true);
    assert.equal(clears, 0);
  } finally { await h.close(); }
});

test('manual settings scrolling marks the visible section without moving keyboard focus', async () => {
  const h = await mountSettings();
  try {
    const body = h.document.querySelector<HTMLElement>('.settings-body')!;
    Object.defineProperties(body, { clientHeight: { value: 400 }, scrollHeight: { value: 2400 } });
    body.style.scrollPaddingTop = '80px';
    const headings = ['settings-display-title', 'completion-notifications-title', 'sync-title', 'backup-card-title', 'settings-proxy-title', 'app-updates-title', 'settings-advanced-toggle'];
    headings.forEach((id, index) => {
      const node = h.document.getElementById(id)!;
      node.getClientRects = () => [{ top: index * 400 - body.scrollTop }] as unknown as DOMRectList;
      node.getBoundingClientRect = () => ({ top: index * 400 - body.scrollTop }) as DOMRect;
    });
    h.document.querySelectorAll<HTMLElement>('.settings-group').forEach((node, index) => {
      node.getBoundingClientRect = () => ({ bottom: (index + 1) * 800 - 40 - body.scrollTop }) as DOMRect;
    });
    const close = h.document.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')!; close.focus();
    await act(async () => { body.scrollTop = 690; body.dispatchEvent(new h.window.Event('scroll')); });
    assert.equal(h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section'), 'overview', 'a group hidden above the sticky navigation yields to the visible group');
    await act(async () => { body.scrollTop = 750; body.dispatchEvent(new h.window.Event('scroll')); });
    assert.equal(h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section'), 'overview');
    assert.equal(h.document.querySelectorAll('[aria-current="location"]').length, 1);
    assert.equal(h.document.activeElement === close, true);
    const scroller = h.document.querySelector<HTMLElement>('.settings-section-scroller')!;
    scroller.getBoundingClientRect = () => ({ left: 0, right: 160 }) as DOMRect;
    h.document.querySelector<HTMLElement>('[data-settings-section=overview]')!.getBoundingClientRect = () => ({ left: 180, right: 260 }) as DOMRect;
    await act(async () => h.window.dispatchEvent(new h.window.Event('resize')));
    assert.equal(scroller.scrollLeft, 100, 'resizing reveals the current item even when its identity does not change');
    assert.equal(h.document.activeElement === close, true);
    await act(async () => { body.scrollTop = 2000; body.dispatchEvent(new h.window.Event('scroll')); });
    assert.equal(h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section'), 'proxy', 'a collapsed last section below the reading edge does not take over');
  } finally { await h.close(); }
});

test('clamped settings jumps retain the requested section until the user scrolls elsewhere', async () => {
  const h = await mountSettings();
  try {
    const body = h.document.querySelector<HTMLElement>('.settings-body')!;
    Object.defineProperties(body, { clientHeight: { value: 604 }, scrollHeight: { value: 2497 } });
    body.getBoundingClientRect = () => ({ top: 52, bottom: 656 }) as DOMRect;
    h.document.querySelector<HTMLElement>('.settings-section-navigation')!.getBoundingClientRect = () => ({ bottom: 130 }) as DOMRect;
    const positions = { 'sync-title': -1700, 'backup-card-title': -1400, 'settings-display-title': -2500,
      'completion-notifications-title': -2300, 'settings-proxy-title': 161, 'app-updates-title': 420, 'settings-advanced-toggle': 610 };
    for (const [id, top] of Object.entries(positions)) {
      const node = h.document.getElementById(id)!;
      node.getClientRects = () => [{}] as unknown as DOMRectList;
      node.getBoundingClientRect = () => ({ top: top + 1893 - body.scrollTop }) as DOMRect;
      node.scrollIntoView = () => { body.scrollTop = 1893; };
    }
    h.document.querySelectorAll<HTMLElement>('.settings-group').forEach((node, index) => {
      node.getBoundingClientRect = () => ({ bottom: [-1800, 137, 575, 660][index] + 1893 - body.scrollTop }) as DOMRect;
    });
    const current = () => h.document.querySelector('[aria-current="location"]')?.getAttribute('data-settings-section');
    for (const section of ['proxy', 'overview']) {
      await h.click(h.document.querySelector<HTMLButtonElement>(`[data-settings-section=${section}]`)!);
      await act(async () => { body.dispatchEvent(new h.window.Event('scroll')); h.window.dispatchEvent(new h.window.Event('resize')); });
      assert.equal(current(), section, 'reaching the same bottom position must not replace the explicit target');
    }
    const focused = h.document.activeElement;
    await act(async () => { body.scrollTop -= 100; body.dispatchEvent(new h.window.Event('scroll')); });
    assert.equal(current(), 'overview', 'manual scrolling resumes tracking actual content');
    assert.equal(h.document.activeElement === focused, true, 'scroll tracking does not move focus');
  } finally { await h.close(); }
});

test('overview keeps display, backup and diagnostics visible while advanced data starts collapsed', async () => {
  const h = await mountSettings();
  try {
    assert.equal(advanced(h.document) === null, false, 'rare data operations must have a progressive disclosure');
    assert.equal(advanced(h.document).open, false);
    assert.equal(h.document.querySelector('.settings-display') === null, false);
    assert.equal(h.document.querySelector('[aria-labelledby="backup-card-title"]') === null, false);
    assert.equal(h.document.getElementById('sync-diagnostics-toggle') === null, false);
    assert.equal(focusableControls(h.document.querySelector('main')!).some(node => node.textContent === settingsCopy.clearHistoryAction), false);
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
