import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { LocalDataCard } from '../src/renderer/local-data-card';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { SETTINGS_RECOVERY_COPY } from '../src/shared/settings-recovery-copy';
import type { LocalDataStats } from '../src/shared/local-data';
import type { SyncStatus } from '../src/shared/sync';
import { mountDom } from './ui/dom-harness';

const copy = { ...getCopy('en'), ...SETTINGS_RECOVERY_COPY.en };
const stats = (history = 2): LocalDataStats => ({ history, archives: 3, decisions: 4, folders: 5,
  answers: 7, memberships: 9, drafts: 0, reset: { preferences: 0, answers: 8, memberships: 10, templates: 6, groups: 1, workspace: 1 } });
const noop = () => {};
const mount = (feedback: (message: string) => void = noop, backup: () => void = noop) => mountDom(<LocalDataCard copy={copy} busy={false}
  onBusy={noop} onFeedback={feedback} onStatus={noop} {...{ onBackup: backup }} />);
const button = (doc: Document, text: string) => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
const confirm = (doc: Document) => doc.querySelector<HTMLButtonElement>('[role="dialog"] .primary')!;

test('counts loading disables confirmation and cancellation discards a late read', async () => {
  let finish!: (value: LocalDataStats) => void, clears = 0;
  setShellApi({ getLocalDataStats: () => new Promise(resolve => { finish = resolve; }), clearHistory: async () => ++clears } as any);
  const h = await mount();
  try {
    const opener = button(h.document, copy.clearHistoryAction);
    opener.focus();
    await h.click(opener);
    assert.equal(confirm(h.document).disabled, true);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Reading current counts/);
    assert.equal(h.document.activeElement!.textContent, copy.cancel);
    await h.click(button(h.document, copy.cancel));
    await act(async () => finish(stats()));
    assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
    assert.equal((h.document.activeElement) === (opener), true);
    assert.equal(clears, 0);
  } finally { await h.close(); setShellApi(null); }
});

test('failed or malformed statistics require an explicit successful reread', async () => {
  let reads = 0, clears = 0;
  setShellApi({ getLocalDataStats: async () => { reads++; if (reads === 1) throw Error('offline'); return reads === 2 ? {} : stats(); },
    clearHistory: async () => ++clears } as any);
  const h = await mount();
  try {
    await h.click(button(h.document, copy.clearHistoryAction));
    assert.equal(confirm(h.document).disabled, true);
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Could not read the counts/);
    assert.doesNotMatch(h.document.querySelector('[role="dialog"]')!.textContent!, /Prompt history: 0/);
    await h.click(button(h.document, copy.localDataStatsRetry));
    assert.equal(confirm(h.document).disabled, true);
    await h.click(button(h.document, copy.localDataStatsRetry));
    assert.equal(confirm(h.document).disabled, false);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Prompt history: 2.*Answer copies: 7/s);
    assert.equal(clears, 0);
  } finally { await h.close(); setShellApi(null); }
});

test('a changed confirmation scope stops for review, refreshes again, and reports actual clearing count', async () => {
  let reads = 0, clears = 0; const messages: string[] = [];
  setShellApi({ getLocalDataStats: async () => stats(++reads === 1 ? 2 : 3), clearHistory: async () => { clears++; return 4; } } as any);
  const h = await mount(value => messages.push(value));
  try {
    await h.click(button(h.document, copy.clearHistoryAction));
    await h.click(confirm(h.document));
    assert.equal(clears, 0);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Counts changed.*Prompt history: 3/s);
    await act(async () => { confirm(h.document).click(); confirm(h.document).click(); });
    assert.equal(clears, 1);
    assert.equal(reads, 3);
    assert.deepEqual(messages, ['Cleared 4 prompt history entries']);
    assert.equal((h.document.querySelector('[role="dialog"]')) === (null), true);
  } finally { await h.close(); setShellApi(null); }
});

test('write failure retains the confirmation and retry rechecks the scope', async () => {
  let reads = 0, clears = 0;
  setShellApi({ getLocalDataStats: async () => { reads++; return stats(); }, clearHistory: async () => { if (++clears === 1) throw Error('failed'); return 2; } } as any);
  const h = await mount();
  try {
    await h.click(button(h.document, copy.clearHistoryAction)); await h.click(confirm(h.document));
    assert.ok(h.document.querySelector('[role="dialog"]'));
    assert.equal(confirm(h.document).disabled, false);
    assert.match(h.document.querySelector('[role="alert"]')!.textContent!, /Could not change local data/);
    await h.click(confirm(h.document));
    assert.equal(reads, 3); assert.equal(clears, 2);
  } finally { await h.close(); setShellApi(null); }
});

test('backup leaves confirmation without clearing, zero categories block but reset still describes all scopes', async () => {
  let backups = 0, resets = 0;
  setShellApi({ getLocalDataStats: async () => stats(0), resetLocalData: async () => { resets++; return {}; } } as any);
  const h = await mount(noop, () => { backups++; });
  try {
    await h.click(button(h.document, copy.clearHistoryAction)); assert.equal(confirm(h.document).disabled, true);
    await h.click(button(h.document, copy.localDataBackupFirst));
    assert.equal(backups, 1); assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    await h.click(button(h.document, copy.resetLocalAction));
    assert.equal(confirm(h.document).disabled, false);
    const text = h.document.querySelector('[role="dialog"]')!.textContent!;
    assert.match(text, /Answer copies: 8.*Folder associations: 10.*Saved templates: 6/s);
    assert.match(text, /Google Drive is not deleted/);
    assert.equal(resets, 0);
  } finally { await h.close(); setShellApi(null); }
});

test('an attached count change requires another explicit confirmation', async () => {
  let reads = 0, clears = 0;
  setShellApi({ getLocalDataStats: async () => ({ ...stats(), answers: ++reads === 1 ? 7 : 8 }),
    clearHistory: async () => ++clears } as any);
  const h = await mount();
  try {
    await h.click(button(h.document, copy.clearHistoryAction));
    await h.click(confirm(h.document));
    assert.equal(clears, 0);
    assert.match(h.document.querySelector('[role="dialog"]')!.textContent!, /Counts changed.*Answer copies: 8/s);
    await h.click(confirm(h.document));
    assert.equal(clears, 1);
  } finally { await h.close(); setShellApi(null); }
});

test('reset with zero business counts remains available and reports the service result', async () => {
  let resets = 0; const feedback: string[] = [];
  const empty: LocalDataStats = { history: 0, archives: 0, decisions: 0, folders: 0, answers: 0, memberships: 0,
    drafts: 0, reset: { preferences: 0, answers: 0, memberships: 0, templates: 0, groups: 0, workspace: 0 } };
  setShellApi({ getLocalDataStats: async () => empty, resetLocalData: async () => { resets++; return {}; } } as any);
  const h = await mount(message => feedback.push(message));
  try {
    await h.click(button(h.document, copy.resetLocalAction));
    assert.equal(confirm(h.document).disabled, false);
    await h.click(confirm(h.document));
    assert.equal(resets, 1);
    assert.deepEqual(feedback, [copy.localDataReset]);
  } finally { await h.close(); setShellApi(null); }
});

test('a reset reply after unmount does not change renderer status or draft state', async () => {
  let finish!: (status: SyncStatus) => void;
  const effects: string[] = [];
  setShellApi({ getLocalDataStats: async () => stats(), resetLocalData: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await mountDom(<LocalDataCard copy={copy} busy={false} onBusy={noop}
    onFeedback={() => effects.push('feedback')} onStatus={() => effects.push('status')} onReset={() => effects.push('reset')} />);
  try {
    await h.click(button(h.document, copy.resetLocalAction));
    await h.click(confirm(h.document));
    await h.close();
    await act(async () => finish({} as SyncStatus));
    assert.deepEqual(effects, [], 'a stale reset result must not reset a newer renderer surface');
  } finally { setShellApi(null); }
});
