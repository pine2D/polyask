import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { DisplayPreferences } from '../src/shared/display';
import { mountSettings, settingsElement } from './ui/settings-dom';

const initial: DisplayPreferences = { density: 'compact', siteScale: 0.9 };
const radio = (doc: Document, group: string, value: string) => doc.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`)!;
function loseNativeFocus(doc: Document) {
  // Chromium blurs disabled controls; jsdom needs this native transition explicitly.
  doc.body.tabIndex = -1; doc.body.focus();
  assert.equal(doc.activeElement === doc.body, true);
}

for (const group of ['settings-density', 'settings-site-scale']) for (const outcome of ['success', 'failure']) {
  test(`${group} restores its accepted choice after ${outcome}`, async () => {
    let finish!: () => void;
    const onDisplayChange = () => new Promise<void>((resolve, reject) => {
      finish = () => outcome === 'success' ? resolve() : reject(Error('save_failed'));
    });
    const h = await mountSettings({ display: initial, onDisplayChange });
    try {
      const next = group === 'settings-density' ? 'comfortable' : '1';
      const old = group === 'settings-density' ? 'compact' : '0.9';
      const input = radio(h.document, group, next);
      input.focus(); await h.click(input);
      assert.equal(input.disabled, true);
      loseNativeFocus(h.document);
      if (outcome === 'success') await h.render(settingsElement({ onDisplayChange,
        display: group === 'settings-density' ? { ...initial, density: 'comfortable' } : { ...initial, siteScale: 1 } }));
      await act(async () => finish());
      const accepted = radio(h.document, group, outcome === 'success' ? next : old);
      assert.equal(accepted.checked && !accepted.disabled, true);
      assert.equal(h.document.activeElement === accepted, true, 'continue arrow navigation in the same radio group');
    } finally { await h.close(); }
  });
}

for (const move of ['focus', 'pointer', 'keyboard', 'category', 'window']) test(`display completion preserves a later ${move} intent`, async () => {
  let finish!: () => void;
  const onDisplayChange = () => new Promise<void>(resolve => { finish = resolve; });
  const h = await mountSettings({ display: initial, onDisplayChange });
  try {
    const input = radio(h.document, 'settings-density', 'comfortable');
    input.focus(); await h.click(input); loseNativeFocus(h.document);
    if (move === 'focus') h.document.querySelector<HTMLButtonElement>('.panel-close')!.focus();
    if (move === 'pointer') h.document.body.dispatchEvent(new h.window.Event('pointerdown', { bubbles: true }));
    if (move === 'keyboard') h.document.body.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    if (move === 'category') await h.click(h.document.querySelector<HTMLElement>('[data-settings-section=sync]')!);
    if (move === 'window') h.window.dispatchEvent(new h.window.Event('blur'));
    const current = h.document.activeElement;
    await act(async () => finish());
    assert.equal(h.document.activeElement === current, true, 'settling a save must not reclaim deliberately moved focus');
  } finally { await h.close(); }
});
