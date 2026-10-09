import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { DraftRecovery } from '../src/renderer/draft-recovery';
import { usePersistentDraft, invalidatePersistentDrafts } from '../src/renderer/use-persistent-draft';
import { setShellApi } from '../src/renderer/shell-api';
import { DRAFT_COPY } from '../src/shared/draft-copy';
import { getCopy } from '../src/shared/copy';
import type { StoredDraft } from '../src/shared/drafts';
import { mountDom } from './ui/dom-harness';

const draft: StoredDraft = { format: 1, id: 'draft-a', deviceId: 'local', updatedAt: 100,
  kind: 'prompt', context: 'composer', title: 'Saved question', content: { text: 'old saved labor' }, sourceUpdatedAt: 10 };
const remote = { ...draft, id: 'draft-b', deviceId: 'remote' };
const backup = { ...draft, id: 'draft-backup', deviceId: 'backup:uuid' };

for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) test(`${locale}: recovery previews copies and protects dirty or changed-source edits`, async () => {
  const copy = { ...getCopy(locale), ...DRAFT_COPY[locale === 'en' ? 'en' : locale === 'zh-CN' ? 'zhCN' : 'zhTW'] }, restored: string[] = [];
  const h = await mountDom(<DraftRecovery copy={copy} drafts={[draft, remote, backup]} deviceId="local" dirty sourceUpdatedAt={11}
    onRestore={value => { restored.push(value.id); return true; }} onRemove={async () => true} />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  try {
    assert.ok(h.document.body.textContent?.includes(copy.draftLocal));
    assert.ok(h.document.body.textContent?.includes(copy.draftRemote));
    assert.ok(h.document.body.textContent?.includes(copy.draftBackup));
    assert.deepEqual(restored, []);
    await h.click(button(copy.draftReview));
    assert.ok(h.document.querySelector('pre')?.textContent?.includes('old saved labor'));
    assert.ok(h.document.body.textContent?.includes(copy.draftSourceChanged));
    await h.click(button(copy.draftRestore));
    assert.deepEqual(restored, []);
    assert.ok(h.document.body.textContent?.includes(copy.draftRestoreConfirm));
    await h.click(button(copy.draftKeepEditing));
    assert.deepEqual(restored, []);
    await h.click(button(copy.draftRestore));
    await h.click(button(copy.draftRestore));
    assert.deepEqual(restored, ['draft-a']);
  } finally { await h.close(); }
});

test('compact recovery uses a portal dialog, notifies the native surface owner and restores focus on close', async () => {
  const copy = { ...getCopy('en'), ...DRAFT_COPY.en }, blocking: boolean[] = [];
  const h = await mountDom(<DraftRecovery copy={copy} drafts={[draft]} deviceId="local" compact
    onBlockingChange={value => blocking.push(value)} onRestore={() => true} onRemove={async () => true} />);
  try {
    const opener = h.document.querySelector<HTMLButtonElement>('[data-draft-open]')!;
    opener.focus(); await h.click(opener);
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    assert.deepEqual(blocking, [true]);
    await act(async () => h.window.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(h.document.querySelector('[role="dialog"]') === null, true);
    assert.deepEqual(blocking, [true, false]);
    assert.equal(h.document.activeElement === opener, true);
  } finally { await h.close(); }
});

test('deleting a copy requires confirmation and a failed removal keeps its preview', async () => {
  const copy = { ...getCopy('en'), ...DRAFT_COPY.en }, removed: string[] = [];
  const h = await mountDom(<DraftRecovery copy={copy} drafts={[remote]} deviceId="local"
    onRestore={() => true} onRemove={async value => { removed.push(value.id); return false; }} />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
  try {
    await h.click(button(copy.draftReview)); await h.click(button(copy.draftRemove));
    assert.deepEqual(removed, []);
    await h.click(button(copy.draftRemove));
    assert.deepEqual(removed, ['draft-b']);
    assert.ok(h.document.body.textContent?.includes(copy.draftRemoveFailed));
    assert.ok(h.document.querySelector('pre')?.textContent?.includes('old saved labor'));
  } finally { await h.close(); }
});

test('hook lists drafts without auto-restoring and unsubscribes while reset rejects unchanged stale content', async () => {
  let epoch = 0, listener: (() => void) | undefined, saves = 0, restored = 0, unsubscriptions = 0;
  setShellApi({ listDrafts: async () => ({ epoch, deviceId: 'local', drafts: [draft] }),
    saveDraft: async () => { saves++; return draft; }, removeDraft: async () => true,
    onDraftsChanged: (callback: () => void) => { listener = callback; return () => { unsubscriptions++; }; }
  } as any);
  let flow!: ReturnType<typeof usePersistentDraft>;
  function Fixture() {
    flow = usePersistentDraft({ kind: 'prompt', context: 'composer', title: '', content: { text: 'current edit' },
      dirty: false, onRestore: () => { restored++; } });
    return <span>{flow.recovery.drafts.length}</span>;
  }
  const h = await mountDom(<Fixture />);
  try {
    assert.equal(flow.recovery.drafts.length, 1); assert.equal(restored, 0); assert.equal(saves, 0);
    await act(async () => { invalidatePersistentDrafts(); epoch++; listener?.(); await Promise.resolve(); });
    assert.equal(await flow.flush(), null); assert.equal(saves, 0);
    await h.close(); assert.equal(unsubscriptions, 1);
  } finally { setShellApi(null); }
});

test('a valid sync timestamp beyond the Date range cannot crash recovery rendering', async () => {
  const copy = { ...getCopy('en'), ...DRAFT_COPY.en };
  const h = await mountDom(<DraftRecovery copy={copy} drafts={[{ ...draft, updatedAt: Number.MAX_SAFE_INTEGER }]} deviceId="local"
    onRestore={() => true} onRemove={async () => true} />);
  try {
    assert.equal(h.document.querySelector('time')?.hasAttribute('datetime'), false);
    assert.ok(h.document.querySelector('time')?.textContent?.length);
  } finally { await h.close(); }
});
