import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { commandHint } from '../src/renderer/command-hint';
import { ConfirmDialog } from '../src/renderer/confirm-dialog';
import { COPY } from '../src/shared/copy';
import { shortcutLabel } from '../src/renderer/shortcut-label';
import { desktopPlatform } from '../src/renderer/platform';

test('shortcut hints use platform notation without changing key bindings', () => {
  assert.equal(commandHint('Next', 'next-page', true), 'Next (⇧⌘⇟)');
  assert.equal(commandHint('Sites', 'open-sites', true), 'Sites (⌥S)');
  assert.equal(commandHint('Settings', 'open-settings', false), 'Settings (Ctrl+,)');
  assert.equal(shortcutLabel('CommandOrControl+Plus', true), '⌘+');
  assert.equal(shortcutLabel('F11', false), 'F11');
});

test('supported desktop user agents resolve consistently', () => {
  assert.equal(desktopPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'darwin');
  assert.equal(desktopPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'win32');
  assert.equal(desktopPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'linux');
});

test('confirmation DOM order follows platform order, preserving keyboard order', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const html = renderToStaticMarkup(<ConfirmDialog copy={COPY.en} title="Remove" message="Irreversible"
      platform={platform} confirmLabel="Confirm action" cancelLabel="Keep data" onConfirm={() => {}} onCancel={() => {}} />);
    const actions = html.slice(html.indexOf('confirm-actions'));
    assert.equal(actions.indexOf('Confirm action') < actions.indexOf('Keep data'), platform === 'win32');
  }
});
