import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { DraftRepository } from '../src/main/draft-repository';
import { SITES } from '../src/main/sites';
import { createSynthesisDraftStore } from '../src/renderer/synthesis-draft';
import { SynthesisWorkspace } from '../src/renderer/synthesis-workspace';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { archiveFixture } from './fixtures';
import { mountDom } from './ui/dom-harness';

test('reopening a source-changed session draft preserves its unreviewed source version in autosave', async () => {
  const database = DesktopDatabase.open(':memory:'); database.meta.put('deviceId', 'local');
  const repository = new DraftRepository(database.state, database.meta, { now: () => 1000, createId: () => 'own-draft' });
  const source = { ...archiveFixture(), updatedAt: 100, results: [
    { host: 'claude.ai', label: 'Claude', text: 'Original first answer' },
    { host: 'chatgpt.com', label: 'ChatGPT', text: 'Original second answer' }
  ] };
  const changedSource = { ...source, updatedAt: 101, results: [
    { ...source.results[0], text: 'A new first answer' }, source.results[1]
  ] };
  const session = createSynthesisDraftStore();
  session.save(source, { selectedHosts: ['claude.ai', 'chatgpt.com'], targetSite: 'kimi',
    tier: null, instruction: 'Unfinished work based on original answers', excerpt: '' });
  const initialDraft = session.restore(changedSource);
  assert.equal(initialDraft?.sourceChanged, true);
  assert.equal(initialDraft?.sourceUpdatedAt, 100);
  setShellApi({
    listDrafts: async (kind?: any, context?: string) => ({ epoch: repository.epoch(), deviceId: 'local', drafts: repository.list(kind, context) }),
    saveDraft: async (input: unknown, epoch: number) => repository.save(input, epoch),
    removeDraft: async (id: string, version: number, epoch: number) => repository.remove(id, version, epoch),
    onDraftsChanged: () => () => {}
  } as any);
  const h = await mountDom(<SynthesisWorkspace copy={getCopy('en')} record={changedSource} sites={SITES}
    defaultTier={null} busy={false} initialDraft={initialDraft} onCancel={() => {}} onSend={() => {}} />);
  try {
    assert.equal(h.document.querySelector<HTMLButtonElement>('.synthesis-workspace footer button')?.disabled, true);
    await h.render(null);
    assert.equal(repository.list('synthesis')[0]?.sourceUpdatedAt, 100,
      'autosave must keep the version requiring explicit source review');
  } finally { await h.close(); setShellApi(null); database.close(); }
});
