import assert from 'node:assert/strict';
import test from 'node:test';
import { PromptDraftRecovery } from '../src/renderer/prompt-draft-recovery';
import { getCopy } from '../src/shared/copy';
import type { StoredDraft } from '../src/shared/drafts';
import { mountDom } from './ui/dom-harness';

for (const accepted of [true, false]) test(`empty prompt recovery confirms attachment removal and clears only accepted content (${accepted})`, async () => {
  const copy = getCopy('zh-CN'); let cleared = 0, restored = 0;
  const draft: StoredDraft = { format: 1, id: 'p', kind: 'prompt', context: 'composer', deviceId: 'remote',
    updatedAt: 100, title: 'remote prompt', content: { text: 'old prompt' } };
  const h = await mountDom(<PromptDraftRecovery copy={copy} busy={false} onClearImages={() => { cleared++; }}
    onBlockingChange={() => {}} recovery={{ drafts: [draft], deviceId: 'local', dirty: false,
      onRestore: async () => { restored++; return accepted; }, onRemove: async () => true }} />);
  const button = (text: string) => [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(v => v.textContent === text)!;
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[data-draft-open]')!);
    await h.click(button(copy.draftReview)); await h.click(button(copy.draftRestore));
    assert.equal(cleared, 0); assert.equal(restored, 0);
    assert.equal(h.document.body.textContent?.includes(copy.questionClearImages), true);
    await h.click(button(copy.draftRestore));
    assert.equal(restored, 1); assert.equal(cleared, accepted ? 1 : 0);
  } finally { await h.close(); }
});
