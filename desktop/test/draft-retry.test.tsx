import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { setShellApi } from '../src/renderer/shell-api';
import { usePersistentDraft } from '../src/renderer/use-persistent-draft';
import { DraftRecovery } from '../src/renderer/draft-recovery';
import { mountDom } from './ui/dom-harness';
import { copy } from './ui/library-test-host';

for (const initial of [true, false]) test(`draft retry recovers a ${initial ? 'first' : 'later'} failed read and saves current work`, async () => {
  let reads = 0, writes = 0, changed: (() => void) | undefined;
  let content = 'current draft';
  const saved = { format: 1, id: 'draft', deviceId: 'local', updatedAt: 1,
    kind: 'prompt', context: 'composer', title: 'Question', content: { text: content } };
  setShellApi({
    listDrafts: async () => {
      reads++;
      if (reads === (initial ? 1 : 2)) throw new Error('temporary IPC read failure');
      return { epoch: 0, deviceId: 'local', drafts: initial ? [] : [saved] };
    },
    saveDraft: async (input: any) => { writes++; return { ...saved, content: input.content }; },
    onDraftsChanged: (listener: () => void) => { changed = listener; return () => {}; }
  } as any);
  function Host() {
    const flow = usePersistentDraft({ kind: 'prompt', context: 'composer', title: 'Question',
      content: { text: content }, onRestore: () => true });
    return <DraftRecovery {...flow.recovery} copy={copy} />;
  }
  const h = await mountDom(<Host />);
  try {
    if (!initial) await act(async () => { changed!(); });
    const retry = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === copy.draftRetry);
    assert.equal(retry !== undefined, true);
    await h.click(retry!);
    assert.equal(reads >= (initial ? 2 : 3), true, 'retry must re-read drafts, including when a saved receipt already exists');
    assert.equal(writes, initial ? 1 : 0, 'matching saved work should not be rewritten');
    assert.equal([...h.document.querySelectorAll('button')].some(b => b.textContent === copy.draftRetry), false);
  } finally { await h.close(); setShellApi(null); }
});
