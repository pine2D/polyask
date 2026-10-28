import assert from 'node:assert/strict';
import React, { act } from 'react';
import test from 'node:test';
import { usePanelFocusReturn } from '../src/renderer/use-panel-focus-return';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';

function Host({ open }: { open: boolean }) {
  usePanelFocusReturn(open);
  return open ? <section className="settings-workspace"><input autoFocus /></section>
    : <div><button id="opener">Settings</button><textarea name="prompt" /><button id="other">Other</button></div>;
}

test('closing a panel restores its recreated shell opener', async () => {
  setShellApi({ restorePanelFocus: async () => false } as any);
  const h = await mountDom(<Host open={false} />, window => { window.document.hasFocus = () => true; });
  try {
    h.document.getElementById('opener')!.focus();
    await h.render(<Host open />); assert.equal(h.document.activeElement?.tagName, 'INPUT');
    await h.render(<Host open={false} />);
    assert.equal(h.document.activeElement?.id, 'opener');
  } finally { await h.close(); setShellApi(null); }
});

for (const action of ['move', 'reopen', 'native']) test(`${action}: a late native return never overrides newer focus`, async () => {
  let settle: (value: boolean) => void = () => {};
  setShellApi({ restorePanelFocus: () => new Promise<boolean>(resolve => { settle = resolve; }) } as any);
  const h = await mountDom(<Host open={false} />, window => { window.document.hasFocus = () => true; });
  try {
    h.document.getElementById('opener')!.focus(); await h.render(<Host open />); await h.render(<Host open={false} />);
    if (action === 'move') h.document.getElementById('other')!.focus();
    if (action === 'reopen') await h.render(<Host open />);
    await act(async () => settle(action === 'native'));
    assert.equal(h.document.activeElement?.id === 'opener', false);
    if (action === 'move') assert.equal(h.document.activeElement?.id, 'other');
    if (action === 'reopen') assert.equal(h.document.activeElement?.tagName, 'INPUT');
  } finally { await h.close(); setShellApi(null); }
});
