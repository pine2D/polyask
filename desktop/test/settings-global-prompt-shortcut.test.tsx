import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { SettingsGlobalPromptShortcut } from '../src/renderer/settings-global-prompt-shortcut';
import { requestDecisionNavigation } from '../src/renderer/decision-navigation';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { GLOBAL_PROMPT_SHORTCUT_COPY } from '../src/shared/global-prompt-shortcut-copy';
import type { GlobalPromptShortcutState } from '../src/shared/global-prompt-shortcut';
import { mountDom } from './ui/dom-harness';

const copy = { ...getCopy('en'), ...GLOBAL_PROMPT_SHORTCUT_COPY.en };
const off: GlobalPromptShortcutState = { accelerator: null, activeAccelerator: null, status: 'disabled', error: null };
const active: GlobalPromptShortcutState = { accelerator: 'Control+Alt+Q', activeAccelerator: 'Control+Alt+Q', status: 'registered', error: null };
function api(patch: Record<string, unknown> = {}) {
  setShellApi({ globalPromptShortcutState: async () => off, setGlobalPromptShortcut: async () => active, ...patch } as any);
}
async function choose(h: Awaited<ReturnType<typeof mountDom>>, key: string) {
  const select = h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!;
  await act(async () => { select.value = key; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
}
async function submit(h: Awaited<ReturnType<typeof mountDom>>) {
  await act(async () => { h.document.querySelector('form')!.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true })); });
}

test('shortcut settings build a combination through accessible native controls and prevent duplicate saving', async () => {
  const calls: unknown[] = []; let finish!: (state: GlobalPromptShortcutState) => void;
  api({ setGlobalPromptShortcut: (value: unknown) => { calls.push(value); return new Promise(resolve => { finish = resolve; }); } });
  const h = await mountDom(<SettingsGlobalPromptShortcut copy={copy} isMac={false} />);
  try {
    assert.equal(h.document.querySelector<HTMLInputElement>('input[value="Control"]')!.checked, false);
    await h.click(h.document.querySelector<HTMLInputElement>('input[value="Control"]')!);
    await h.click(h.document.querySelector<HTMLInputElement>('input[value="Alt"]')!);
    await choose(h, 'Q'); await submit(h); await submit(h);
    assert.deepEqual(calls, ['Control+Alt+Q']);
    assert.equal(h.document.querySelector('fieldset')!.disabled, true);
    await act(async () => finish(active));
    assert.equal(h.document.querySelector('fieldset')!.disabled, false);
    assert.match(h.document.querySelector('#global-prompt-shortcut-status')!.textContent!, /Ctrl\+Alt\+Q/);
  } finally { await act(async () => finish?.(active)); await h.close(); setShellApi(null); }
});

test('registration conflict keeps the attempted input and current effective shortcut visible', async () => {
  const feedback: string[] = [];
  api({ globalPromptShortcutState: async () => active, setGlobalPromptShortcut: async () => ({ ...active, error: 'conflict' }) });
  const h = await mountDom(<SettingsGlobalPromptShortcut copy={copy} onFeedback={message => feedback.push(message)} />);
  try {
    await choose(h, 'W'); await submit(h);
    assert.equal(h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!.value, 'W');
    assert.match(h.document.querySelector('#global-prompt-shortcut-status')!.textContent!, /Ctrl\+Alt\+Q/);
    assert.equal(feedback.at(-1), copy.globalShortcutConflict);
    assert.equal(h.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('async failure restores focus lost when the saving fieldset becomes disabled', async () => {
  let finish!: (state: GlobalPromptShortcutState) => void;
  api({ globalPromptShortcutState: async () => active, setGlobalPromptShortcut: () => new Promise(resolve => { finish = resolve; }) });
  const h = await mountDom(<SettingsGlobalPromptShortcut copy={copy} />);
  try {
    await choose(h, 'W');
    const button = h.document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.focus(); await submit(h);
    // jsdom does not perform Chromium's blur on disabled fieldsets; reproduce its native destination.
    h.document.body.tabIndex = -1; h.document.body.focus();
    assert.equal(h.document.activeElement === h.document.body, true);
    await act(async () => finish({ ...active, error: 'conflict' }));
    assert.equal(h.document.activeElement === button, true);
  } finally { await h.close(); setShellApi(null); }
});

test('reset invalidates an outstanding save and stale feedback cannot return to the reset form', async () => {
  let finish!: (state: GlobalPromptShortcutState) => void; const feedback: string[] = [];
  api({ globalPromptShortcutState: async () => active,
    setGlobalPromptShortcut: () => new Promise(resolve => { finish = resolve; }) });
  const props = { copy, onFeedback: (message: string) => feedback.push(message) };
  const h = await mountDom(<SettingsGlobalPromptShortcut {...props} resetKey={0} />);
  try {
    await choose(h, 'W'); await submit(h);
    api(); await h.render(<SettingsGlobalPromptShortcut {...props} resetKey={1} />);
    await act(async () => finish({ ...active, accelerator: 'Control+Alt+W', activeAccelerator: 'Control+Alt+W' }));
    assert.equal(h.document.querySelector<HTMLSelectElement>('#global-prompt-shortcut-key')!.value, '');
    assert.equal(h.document.querySelector('#global-prompt-shortcut-status')!.textContent, copy.globalShortcutDisabled);
    assert.equal(feedback.length, 0);
  } finally { await h.close(); setShellApi(null); }
});

test('busy settings reject synthetic saves and failed reads require retry before editing', async () => {
  let reads = 0, writes = 0;
  api({ globalPromptShortcutState: async () => { if (++reads === 1) throw new Error('private detail'); return active; },
    setGlobalPromptShortcut: async () => { writes++; return active; } });
  const h = await mountDom(<SettingsGlobalPromptShortcut copy={copy} disabled />);
  try {
    assert.equal(h.document.querySelector('fieldset')!.disabled, true);
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-shortcut-retry]')!);
    await submit(h);
    assert.equal(reads, 2); assert.equal(writes, 0);
    assert.equal(h.document.body.textContent!.includes('private detail'), false);
  } finally { await h.close(); setShellApi(null); }
});

test('an unsaved shortcut change uses the existing navigation confirmation boundary', async () => {
  api({ globalPromptShortcutState: async () => active }); let navigated = 0;
  const h = await mountDom(<SettingsGlobalPromptShortcut copy={copy} />);
  try {
    await choose(h, 'W');
    await act(async () => requestDecisionNavigation(() => { navigated++; }, { kind: 'command', id: 'focus-prompt' }));
    assert.equal(navigated, 0);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(navigated, 1);
  } finally { await h.close(); setShellApi(null); }
});
