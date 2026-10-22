import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { shell, setShellApi } from '../src/renderer/shell-api';
import { emptyComparisonDraft } from '../src/renderer/comparison-draft';
import { comparisonCopy as copy, comparisonMount, comparisonRecord, comparisonWait } from './ui/comparison-dom';

for (const [mode, scrollEvent] of [['read', true], ['compare', true], ['read', false]] as const) test(`canceling a new decision returns to the original ${mode} position and action${scrollEvent ? '' : ' before the scroll event'}`, async () => {
  const h = await comparisonMount({ startInRead: mode === 'read', detailWidth: 700 });
  try {
    const focused = h.document.querySelector('.folder-workspace')!.getAttribute('data-focused');
    if (mode === 'compare') {
      await h.choose(copy.leftAnswer, 'Kimi');
      const columns = h.document.querySelectorAll<HTMLElement>('.archive-compare-column');
      await h.scroll(columns[0], 230); await h.scroll(columns[1], 370);
      await h.click(h.button(copy.manualTitle)!);
      await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')!, 'Keep this reviewed judgment.');
      await h.scroll(h.document.querySelector<HTMLElement>('.manual-comparison')!, 320);
      // Chromium 的隐藏栏不再有布局；离开时不能用它们的零值覆盖阅读会话。
      columns.forEach(column => { column.scrollTop = 0; });
    }
    const list = h.document.querySelector<HTMLElement>('.folder-content-list .archive-list')!;
    await h.scroll(list, 110);
    const pane = h.document.querySelector<HTMLElement>('.archive-detail-pane')!;
    if (scrollEvent) await h.scroll(pane, 430); else pane.scrollTop = 430;
    const label = mode === 'read' ? copy.decisionCreate : copy.manualFormDecision;
    h.button(label)!.focus(); await h.click(h.button(label)!);
    await comparisonWait(() => h.document.querySelector('[name=decision-title]'));
    const cancel = () => [...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionCancel)!;
    await h.click(cancel());
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.confirm-actions button')].find(node => node.textContent === copy.cancel)!);
    assert.equal(!!h.document.querySelector('[name=decision-title]'), true, 'declining discard keeps the new card');
    await h.click(cancel());
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(!!h.document.querySelector('.archive-detail'), true, 'discard returns to the selected source');
    assert.equal(!!h.document.querySelector('.decision-workspace'), false);
    assert.equal(h.document.querySelector('.archive-detail')!.getAttribute('data-view'), mode);
    assert.equal(h.document.querySelector('.folder-workspace')!.getAttribute('data-focused'), focused);
    assert.equal(h.document.querySelector<HTMLElement>('.archive-detail-pane')!.scrollTop, 430);
    assert.equal(list.scrollTop, 110);
    if (mode === 'compare') {
      await comparisonWait(() => h.document.querySelector<HTMLDetailsElement>('.manual-comparison')?.open);
      assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=comparison-judgment]')!.value, 'Keep this reviewed judgment.');
      assert.equal(h.document.querySelector<HTMLElement>('.manual-comparison')!.scrollTop, 320);
      assert.equal(h.document.activeElement === h.button(label), true, 'return restores the original action');
      await h.click(h.button(copy.comparisonReturnAnswers)!);
      assert.equal([...h.document.querySelectorAll<HTMLElement>('.archive-compare-column')].map(node => node.scrollTop).join(','), '230,370');
      assert.equal(h.document.querySelector('.archive-compare-column h3')!.textContent, 'Kimi');
    } else assert.equal(h.document.activeElement === h.button(label), true, 'return restores the original action');
    assert.equal(h.writes + h.decisionWrites, 0);
  } finally { await h.close(); }
});

test('returning to reading does not consume an existing pending analysis navigation again', async () => {
  const h = await comparisonMount({ startInRead: true, pendingSynthesis: { archiveId: comparisonRecord.id,
    targetSite: 'claude', targetHost: 'claude.ai', tier: null, instruction: 'Check evidence', sentAt: 200 } });
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('.library-view-switch button')!);
    h.button(copy.decisionCreate)!.focus(); await h.click(h.button(copy.decisionCreate)!);
    await comparisonWait(() => h.document.querySelector('[name=decision-title]'));
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionCancel)!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(h.document.querySelector('.archive-detail')?.getAttribute('data-view'), 'read');
    assert.equal(h.document.activeElement === h.button(copy.decisionCreate), true);
  } finally { await h.close(); }
});

test('mouse evidence activation freezes its source origin before asynchronous verification', async () => {
  const h = await comparisonMount({ startInRead: true });
  try {
    const text = h.document.querySelector('.archive-answer-reading-body p')!.firstChild!;
    const range = h.document.createRange(); range.selectNodeContents(text);
    const selection = h.window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    await act(async () => text.parentElement!.dispatchEvent(new h.window.Event('pointerup', { bubbles: true })));
    let finish: ((value: typeof comparisonRecord) => void) | undefined;
    h.readWith(() => new Promise(resolve => { finish = resolve; }));
    const evidence = [...h.document.querySelectorAll<HTMLButtonElement>('.answer-excerpt-actions button')].find(node => node.textContent === copy.excerptUseEvidence)!;
    await h.click(evidence);
    h.button(copy.decisionCreate)!.focus();
    await act(async () => finish!(comparisonRecord));
    await comparisonWait(() => h.document.querySelector('[name=decision-title]'));
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionCancel)!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal((h.document.activeElement as HTMLElement).dataset.decisionOrigin, 'excerpt:0');
    assert.equal((h.document.activeElement as HTMLElement).classList.contains('answer-excerpt-open'), true);
  } finally { await h.close(); }
});

test('a new pending analysis preserves unsaved metadata until its navigation is approved', async () => {
  const h = await comparisonMount({ startInRead: true });
  try {
    await h.input(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!, 'Keep this unsaved note.');
    const pending = { archiveId: comparisonRecord.id, targetSite: 'claude', targetHost: 'claude.ai', tier: null, instruction: 'Check', sentAt: 300 } as const;
    await h.setPending(pending);
    assert.equal(!!h.document.querySelector('.confirm-dialog'), true, 'new analysis uses the existing navigation guard');
    assert.equal(h.document.querySelector('.archive-detail')!.getAttribute('data-view'), 'read');
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.confirm-actions button')].find(node => node.textContent === copy.cancel)!);
    assert.equal(h.document.querySelector<HTMLTextAreaElement>('[name=archive-note]')!.value, 'Keep this unsaved note.');
    await h.setPending({ ...pending, sentAt: 301 });
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(h.document.querySelector('.archive-detail')!.getAttribute('data-view'), 'synthesis');
  } finally { await h.close(); }
});

test('asynchronous recovery entries do not change the manual decision return action', async () => {
  let delayed = false;
  const h = await comparisonMount({ configure: () => {
    const base = { listFolders: shell.listFolders, queryFolderContents: shell.queryFolderContents, listArchiveTags: shell.listArchiveTags,
      getArchive: shell.getArchive, createDecision: shell.createDecision, updateArchive: shell.updateArchive };
    const remote = { format: 1, id: 'remote-comparison', kind: 'comparison', context: comparisonRecord.id,
      deviceId: 'other', updatedAt: 1000, title: 'Recovered comparison', content: emptyComparisonDraft(comparisonRecord), sourceUpdatedAt: comparisonRecord.updatedAt };
    setShellApi({ ...base, listDrafts: async (kind?: string) => {
      if (kind === 'comparison' && delayed) return new Promise(() => {});
      return { epoch: 0, deviceId: 'local', drafts: kind === 'comparison' ? [remote] : [] };
    } } as any);
  } });
  try {
    await comparisonWait(() => h.document.querySelector('.draft-recovery-entry'));
    await h.click(h.button(copy.manualTitle)!);
    h.button(copy.manualFormDecision)!.focus(); await h.click(h.button(copy.manualFormDecision)!);
    await comparisonWait(() => h.document.querySelector('[name=decision-title]'));
    delayed = true;
    await h.click([...h.document.querySelectorAll<HTMLButtonElement>('.decision-detail-actions button')].find(node => node.textContent === copy.decisionCancel)!);
    await h.click(h.document.querySelector<HTMLButtonElement>('.confirm-actions .primary')!);
    assert.equal(h.document.activeElement === h.button(copy.manualFormDecision), true);
    assert.equal(h.document.querySelector<HTMLDetailsElement>('.manual-comparison')!.open, true);
  } finally { await h.close(); }
});
