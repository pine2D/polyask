import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import { mountSettings } from './ui/settings-dom';
import { mountLibrary, workspace, waitForInitial } from './ui/library-test-host';
import { withFolderPages } from './ui/library-page-api';
import { setShellApi } from '../src/renderer/shell-api';
import { registerDecisionNavigationGuard } from '../src/renderer/decision-navigation';

test('settings leave handled Escape and IME to the inner control, and otherwise dismiss immediately', async () => {
  let closed = 0; const h = await mountSettings({ onClose: () => closed++ });
  try {
    const send = async (patch = {}, handled = false) => {
      const event = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...patch });
      if (handled) event.preventDefault();
      await act(async () => h.document.body.dispatchEvent(event));
    };
    await send({}, true); await send({ isComposing: true }); await send({ keyCode: 229 });
    assert.equal(closed, 0);
    await send(); assert.equal(closed, 1);
  } finally { await h.close(); }
});

test('result library Escape closes through the existing decision guard and respects handled/IME events', async () => {
  let closed = 0, guarded = 0, allow: (() => void) | null = null;
  setShellApi(withFolderPages({ listFolders: async () => [], listArchiveTags: async () => [], searchFolderContents: async () => [] }) as any);
  const h = await mountLibrary(workspace({ onClose: () => closed++ }));
  try {
    await waitForInitial();
    const dispose = registerDecisionNavigationGuard(action => { guarded++; allow = action; });
    try {
      for (const patch of [{ isComposing: true }, { keyCode: 229 }, { handled: true }]) {
        const e = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...patch });
        if ('handled' in patch) e.preventDefault();
        await act(async () => h.document.body.dispatchEvent(e));
      }
      assert.equal(guarded, 0);
      await act(async () => h.document.body.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
      assert.equal(guarded, 1); assert.equal(closed, 0);
      await act(async () => { allow?.(); }); assert.equal(closed, 1);
    } finally { dispose(); }
  } finally { await h.close(); setShellApi(null); }
});
