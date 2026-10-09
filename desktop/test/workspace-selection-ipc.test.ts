import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { WorkspaceService } from '../src/main/workspace-service';
import { registerWorkspaceSelectionIpc } from '../src/main/workspace-selection-ipc';

test('participation IPC validates trust and input before persisting and publishing accepted state', () => {
  const database = DesktopDatabase.open(':memory:');
  const handlers = new Map<string, Function>();
  let publications = 0;
  const workspace = new WorkspaceService(database.state, database.meta, () => {}, { createDeviceId: () => 'local' });
  registerWorkspaceSelectionIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, workspace,
    event => event === 'shell' as any, () => { publications++; return workspace.getState(); });
  try {
    const select = handlers.get('polyask:set-selection')!, sendTo = handlers.get('polyask:set-participation')!;
    select('shell', ['claude', 'kimi']);
    assert.throws(() => sendTo('site', ['kimi']), /untrusted_sender/);
    assert.throws(() => sendTo('shell', ['gemini']), /invalid_site_selection/);
    assert.equal(publications, 1);
    assert.deepEqual(sendTo('shell', ['kimi']).participatingSites, ['kimi']);
    assert.equal(publications, 2);
    assert.deepEqual(workspace.getState().selectedSites, ['claude', 'kimi']);
    assert.deepEqual(sendTo('shell', []).participatingSites, []);
  } finally { database.close(); }
});
