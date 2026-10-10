import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDialog } from '../src/renderer/confirm-dialog';
import { DraftRecovery } from '../src/renderer/draft-recovery';
import { LocalDataCard } from '../src/renderer/local-data-card';
import { draftSummary } from '../src/renderer/draft-preview-model';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import type { StoredDraft } from '../src/shared/drafts';
import type { LocalDataStats } from '../src/shared/local-data';
import { mountDom } from './ui/dom-harness';

const noop = () => {};
const stats: LocalDataStats = { history: 2, archives: 3, decisions: 4, folders: 5, answers: 7, memberships: 9, drafts: 0,
  reset: { preferences: 0, answers: 8, memberships: 10, templates: 6, groups: 1, workspace: 1 } };
const drafts: StoredDraft[] = ['a', 'b'].map((id, index) => ({ format: 1, id: `draft-${id}`, deviceId: 'remote', updatedAt: 100 + index,
  kind: 'prompt', context: 'composer', title: 'Same title', content: { text: `Same title\nbody ${id}` } }));
const button = (doc: Document, text: string) => [...doc.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;

test('ConfirmDialog marks irreversible confirmations with the danger tone only when asked', () => {
  const copy = getCopy('en');
  const render = (tone?: 'danger') => renderToStaticMarkup(<ConfirmDialog copy={copy} title="Delete" message="Gone" tone={tone}
    confirmLabel="Delete" cancelLabel="Cancel" onConfirm={noop} onCancel={noop} />);
  assert.match(render('danger'), /class="primary danger"[^>]*>Delete</);
  assert.doesNotMatch(render(), /primary danger/);
});

for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) test(`${locale}: local data confirmation explains the counts right before the list, with a danger action`, async () => {
  const copy = getCopy(locale);
  setShellApi({ getLocalDataStats: async () => stats } as any);
  const h = await mountDom(<LocalDataCard copy={copy} busy={false} onBusy={noop} onFeedback={noop} onStatus={noop} />);
  try {
    await h.click(button(h.document, copy.clearHistoryAction));
    await act(async () => { await Promise.resolve(); });
    const dialog = h.document.querySelector('[role="dialog"]')!;
    const snapshot = dialog.querySelector('#local-confirm-snapshot')!;
    assert.equal(snapshot.nextElementSibling?.className, 'local-data-counts', 'the "following counts" sentence must sit directly above the list');
    assert.equal(dialog.querySelector('.confirm-actions .primary')!.classList.contains('danger'), true);
  } finally { await h.close(); setShellApi(null); }
});

test('draft list items carry a distinguishing summary', () => {
  const copy = getCopy('zh-CN');
  assert.equal(draftSummary(drafts[0], copy), '17 字', 'title already shows the first line');
  assert.equal(draftSummary({ kind: 'prompt', title: 'Other', content: { text: '\n  first line\nsecond' } }, copy), 'first line · 20 字');
  assert.equal(draftSummary({ kind: 'synthesis', title: 'S', content: { instruction: 'Merge', selectedHosts: ['claude', 'kimi'] } }, copy), 'Merge · 5 字 · 2 个来源');
});

test('draft preview opens in place under the chosen copy and toggles closed', async () => {
  const copy = getCopy('en');
  const h = await mountDom(<DraftRecovery copy={copy} drafts={drafts} deviceId="local" onRestore={() => true} onRemove={async () => true} />);
  try {
    const items = () => [...h.document.querySelectorAll<HTMLLIElement>('.draft-copy-list > li')];
    const second = items()[1].querySelector('button')!;
    assert.equal(second.getAttribute('aria-expanded'), 'false');
    await h.click(second);
    assert.equal(items()[1].querySelector('.draft-preview') === null, false, 'preview renders inside the clicked item');
    assert.equal(items()[0].querySelector('.draft-preview') === null, true);
    assert.equal(items()[1].dataset.selected, 'true');
    assert.equal(second.getAttribute('aria-expanded'), 'true');
    assert.equal(second.textContent, copy.draftHide);
    assert.equal(second.getAttribute('aria-controls'), items()[1].querySelector('.draft-preview')!.id);
    await h.click(second);
    assert.equal(h.document.querySelector('.draft-preview') === null, true);
    assert.equal(second.textContent, copy.draftReview);
  } finally { await h.close(); }
});

test('inline draft entry hides without copies but still surfaces a failed save', async () => {
  const copy = getCopy('zh-TW');
  const empty = await mountDom(<DraftRecovery copy={copy} drafts={[]} deviceId="local" status="saved" onRestore={() => true} onRemove={async () => true} />);
  try { assert.equal(empty.document.querySelector('.draft-recovery-entry') === null, true); } finally { await empty.close(); }
  const failed = await mountDom(<DraftRecovery copy={copy} drafts={[]} deviceId="local" status="error" onRestore={() => true} onRemove={async () => true} />);
  try { assert.equal(failed.document.querySelector('.draft-recovery-entry') === null, false); } finally { await failed.close(); }
});

test('browsing dialogs close with "Close" while transactional ones keep "Cancel"', async () => {
  const copy = getCopy('zh-CN');
  const h = await mountDom(<DraftRecovery copy={copy} drafts={drafts} deviceId="local" compact onBlockingChange={noop}
    onRestore={() => true} onRemove={async () => true} />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-draft-open]')!);
    assert.equal(h.document.querySelector('.folder-modal header button')!.textContent, '关闭');
  } finally { await h.close(); }
});
