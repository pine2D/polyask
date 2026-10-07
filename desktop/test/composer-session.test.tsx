import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createRef, useState } from 'react';
import { CommandBar } from '../src/renderer/command-bar';
import { getCopy } from '../src/shared/copy';
import type { Tier } from '../src/shared/protocol';
import { mountDom } from './ui/dom-harness';

const noop = () => undefined;
async function composerSession() {
  const transitions: boolean[] = [];
  const ref = createRef<HTMLTextAreaElement>();
  function Session() {
    const [expanded, setExpanded] = useState(false);
    const [tier, setTier] = useState<Tier>(null);
    return <CommandBar copy={getCopy('en')} promptRef={ref} text={'long draft\n'.repeat(30)}
      tier={tier} runState="idle" auxiliaryBusy={false} layoutMode="overview" selectedCount={2}
      failureCount={0} cancelledCount={0} scopeLabel="Custom · 2" healthAttention={0} panelTab={null}
      imageControl={<button name="attachments">Manage images</button>} sendBlockedReason={null}
      synthesisPending={false} syncStatus={{ state: 'idle', connected: false, pending: 0,
        errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true }}
      isMac={false} expanded={expanded} onTextChange={noop} onSubmit={noop} onCancel={noop}
      onTierChange={setTier} onLayoutChange={noop} onExpandedChange={value => {
        transitions.push(value); setExpanded(value);
      }} onPanelChange={noop} onShowGroupMenu={noop} onOpenMore={noop} onOpenArchive={noop}
      onRetry={noop} onPasteImages={noop} />;
  }
  const h = await mountDom(<Session />);
  const area = h.document.querySelector('textarea')!;
  const focus = async (node: HTMLElement) => { await act(async () => node.focus()); };
  return { ...h, area, transitions, focus };
}

test('tier and attachment focus keep the same expanded prompt and editing position', async () => {
  const h = await composerSession();
  try {
    await h.focus(h.area);
    h.area.setSelectionRange(12, 25, 'backward'); h.area.scrollTop = 72;
    for (const selector of ['[data-tier-icon="fast"]', '[data-tier-icon="think"]', '[name="attachments"]']) {
      const button = h.document.querySelector<HTMLButtonElement>(selector)!;
      await h.focus(button); await h.click(button);
      assert.equal(h.document.querySelector('.command-bar')!.classList.contains('is-expanded'), true);
      assert.equal(h.document.querySelector('textarea') === h.area, true);
      assert.equal(h.area.selectionStart, 12); assert.equal(h.area.selectionEnd, 25);
      assert.equal(h.area.scrollTop, 72);
      await h.focus(h.area);
    }
    assert.equal(h.transitions.includes(false), false, 'focus changes must not lower the native composer reserve');
  } finally { await h.close(); }
});

test('a null-relatedTarget blur keeps editing expanded and restores the saved position only on refocus', async () => {
  const h = await composerSession();
  try {
    await h.focus(h.area);
    h.area.setSelectionRange(19, 37, 'forward'); h.area.scrollTop = 88;
    await act(async () => h.area.blur());
    assert.equal(h.document.querySelector('.command-bar')!.classList.contains('is-expanded'), true);
    h.area.setSelectionRange(0, 0); h.area.scrollTop = 0;
    await h.focus(h.area);
    assert.equal(h.area.selectionStart, 19); assert.equal(h.area.selectionEnd, 37);
    assert.equal(h.area.selectionDirection, 'forward'); assert.equal(h.area.scrollTop, 88);
  } finally { await h.close(); }
});

test('explicit collapse remains collapsed with focus on its control and current mode is visible', async () => {
  const h = await composerSession();
  try {
    await h.focus(h.area);
    const toggle = h.document.querySelector<HTMLButtonElement>('[data-composer-toggle]');
    assert.equal(toggle === null, false, 'the editing session needs an explicit expand/collapse control');
    await h.focus(toggle!); await h.click(toggle!);
    assert.equal(toggle!.getAttribute('aria-expanded'), 'false');
    assert.equal(h.document.activeElement === toggle, true);
    assert.equal(h.document.querySelector('.command-bar')!.classList.contains('is-expanded'), false);
    assert.equal(h.document.querySelector('[data-current-tier]')?.textContent, 'Site');
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-tier-icon="think"]')!);
    assert.equal(h.document.querySelector('[data-current-tier]')?.textContent, 'Think');
  } finally { await h.close(); }
});
