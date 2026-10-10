import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArchiveRecord } from '../src/shared/archive';
import type { DecisionRecord } from '../src/shared/decision';
import type { FolderContent } from '../src/shared/task-folder';
import { archiveFixture } from './fixtures';
import { withFolderPages } from './ui/library-page-api';

const archive = archiveFixture();
const decision: DecisionRecord = { id: archive.id, archiveId: archive.id, title: 'Decision', sourceTitle: archive.task,
  conclusion: '', rationale: '', uncertainties: '', nextStep: '', status: 'draft', evidence: [],
  createdAt: 1_000, updatedAt: 1_000, deviceId: 'fixture', schema: 2 };
const items: FolderContent[] = [{ kind: 'archive', record: archive }, { kind: 'decision', record: decision }];

test('page fixture archive getters pass through fresh versions and null independently of cached list records', async () => {
  let current: ArchiveRecord | null = archive;
  const api = withFolderPages({ searchFolderContents: async () => items, getArchive: async () => current });
  await api.queryFolderContents({});
  current = { ...archive, updatedAt: archive.updatedAt + 1 };
  assert.equal((await api.getArchive(archive.id)).updatedAt, 1_001);
  current = null;
  assert.equal(await api.getArchive(archive.id) === null, true);
});

test('page fixture decision getters pass through fresh versions and null independently of cached list records', async () => {
  let current: DecisionRecord | null = decision;
  const api = withFolderPages({ searchFolderContents: async () => items, getDecision: async () => current });
  await api.queryFolderContents({});
  current = { ...decision, title: 'Updated decision', updatedAt: decision.updatedAt + 1 };
  assert.equal((await api.getDecision(decision.id)).title, 'Updated decision');
  current = null;
  assert.equal(await api.getDecision(decision.id) === null, true);
});

test('only legacy fixtures without a getter resolve cached records by kind and ID', async () => {
  const api = withFolderPages({ searchFolderContents: async () => items });
  await api.queryFolderContents({});
  assert.equal((await api.getArchive(archive.id)).task, archive.task);
  assert.equal((await api.getDecision(decision.id)).title, 'Decision');
  assert.equal(await api.getArchive('missing') === null, true);
  assert.equal(await api.getDecision('missing') === null, true);
});
