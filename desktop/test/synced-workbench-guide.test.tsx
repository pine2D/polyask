import assert from 'node:assert/strict';
import test from 'node:test';
import { act, useState } from 'react';
import type { WorkbenchGuideState } from '../src/shared/preferences';
import { useWorkbenchGuide } from '../src/renderer/use-workbench-guide';
import { mountDom } from './ui/dom-harness';

test('shared guide state supersedes the legacy local field without writing it back', async () => {
  let guide!: ReturnType<typeof useWorkbenchGuide>, publish!: (value: WorkbenchGuideState) => void;
  const writes: string[] = [];
  const storage = { getItem: () => JSON.stringify({ density: 'compact', siteScale: 0.9,
    workbenchGuide: { version: 1, disposition: 'dismissed' } }), setItem: (key: string) => { writes.push(key); } };
  function Fixture() {
    const [preference, setPreference] = useState<WorkbenchGuideState>(null); publish = setPreference;
    guide = useWorkbenchGuide({ storage, preference, fallbackDisplay: { density: 'compact', siteScale: 0.9 },
      ready: true, busy: false, participating: ['claude', 'kimi', 'gemini'], runId: null,
      activeSites: [], statuses: {}, progress: null, onPersistenceFailure: () => {}, onNavigate: () => {} });
    return <span>{guide.model.stage}</span>;
  }
  const h = await mountDom(<Fixture />);
  try {
    assert.equal(guide.model.stage, 'choose');
    await act(async () => publish({ version: 1, disposition: 'completed' }));
    assert.equal(guide.model.stage, 'hidden');
    assert.equal(guide.dismiss(), false);
    assert.deepEqual(writes, []);
  } finally { await h.close(); }
});

test('guide dismissal uses the shared persistence callback when provided', async () => {
  let guide!: ReturnType<typeof useWorkbenchGuide>;
  const writes: string[] = [], changes: WorkbenchGuideState[] = [];
  function Fixture() {
    guide = useWorkbenchGuide({ storage: { getItem: () => null, setItem: key => { writes.push(key); } },
      preference: null, onPreferenceChange: async value => { changes.push(value); },
      fallbackDisplay: { density: 'compact', siteScale: 0.9 }, ready: true, busy: false,
      participating: ['claude', 'kimi'], runId: null, activeSites: [], statuses: {}, progress: null,
      onPersistenceFailure: () => {}, onNavigate: () => {} });
    return <span>{guide.model.stage}</span>;
  }
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => { guide.dismiss(); });
    assert.deepEqual(changes, [{ version: 1, disposition: 'dismissed' }]);
    assert.equal(guide.model.stage, 'hidden');
    assert.deepEqual(writes, []);
  } finally { await h.close(); }
});
