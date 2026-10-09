import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DesktopDatabase } from '../src/main/database';
import { SyncRepository } from '../src/main/sync-repository';
import { WorkspaceService } from '../src/main/workspace-service';
import { BackupService } from '../src/main/backup-service';

function fixture(deviceId: string, path = ':memory:') {
  const database = DesktopDatabase.open(path);
  database.meta.put('deviceId', deviceId);
  const workspace = new WorkspaceService(database.state, database.meta, () => {}, { now: () => 100 });
  return { database, workspace, sync: new SyncRepository(database) };
}
function seed(f: ReturnType<typeof fixture>, sites: string[] = ['kimi']) {
  f.database.state.put('workspace', { selectedSites: ['claude', 'kimi'], tier: null, updatedAt: 10,
    deviceId: 'a', participation: { sites, updatedAt: 20, deviceId: 'a' } }, 20);
}
function participants(f: ReturnType<typeof fixture>) {
  return (f.workspace.getState() as { participatingSites?: readonly string[] }).participatingSites;
}

test('send exclusions survive database reopen and unrelated tier/page edits', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyask-participation-')), path = join(dir, 'data.sqlite');
  const a = fixture('a', path);
  seed(a); a.database.close();
  const b = fixture('a', path);
  try {
    assert.deepEqual(participants(b), ['kimi']);
    b.workspace.setTier('think');
    b.workspace.setSelection(['kimi', 'claude']);
    assert.deepEqual(participants(b), ['kimi']);
    assert.equal((b.database.state.get<any>('workspace')).participation.updatedAt, 20);
  } finally { b.database.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('participation uses its own sync version and keeps an explicit empty selection', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    seed(a, []);
    const wire = JSON.parse(JSON.stringify(a.sync.localStateFragment()));
    assert.deepEqual(wire.settings['amsConsole.participating'], { value: {}, updatedAt: 20, deviceId: 'a' });
    b.sync.applyStateFragments({ a: wire });
    assert.deepEqual(participants(b), []);
    b.workspace.setTier('think');
    const edited = b.sync.localStateFragment();
    assert.equal(edited.settings['amsConsole.participating'].updatedAt, 20);
    a.sync.applyStateFragments({ b: edited });
    assert.deepEqual(participants(a), []);
  } finally { a.database.close(); b.database.close(); }
});

test('legacy state defaults to open pages; malformed participation cannot enable sends', () => {
  const f = fixture('local');
  try {
    f.workspace.setSelection(['kimi', 'claude']);
    assert.deepEqual(participants(f), ['kimi', 'claude']);
    seed(f, []);
    const wire = f.sync.localStateFragment();
    const malformed = { ...wire, settings: { ...wire.settings,
      'amsConsole.participating': { value: { 'claude.ai': 'false' }, updatedAt: 200, deviceId: 'remote' } } };
    f.sync.applyStateFragments({ remote: malformed });
    assert.deepEqual(participants(f), []);
  } finally { f.database.close(); }
});

test('frozen participation wire survives reset and preserves unknown host flags', () => {
  const f = fixture('local');
  const { body } = JSON.parse(readFileSync(join(__dirname, 'fixtures/schema1-state-participation.json'), 'utf8'));
  try {
    f.sync.applyStateFragments({ remote: body });
    assert.deepEqual(participants(f), ['kimi']);
    f.workspace.setTier('fast');
    assert.deepEqual(f.sync.localStateFragment().settings['amsConsole.participating'].value,
      { 'future.example': false, 'www.kimi.com': true });
    f.database.resetLocalData();
    assert.equal(f.database.state.get('workspace'), null);
    f.sync.applyStateFragments({ remote: body });
    assert.deepEqual(participants(f), ['kimi']);
  } finally { f.database.close(); }
});

test('business backup restores participation with a fresh local sync version', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    seed(a);
    const backupA = new BackupService(a.database, { deviceId: () => 'a', now: () => 300 });
    const backupB = new BackupService(b.database, { deviceId: () => 'b', now: () => 400 });
    const exported = backupA.export();
    assert.deepEqual(exported.entries.find(e => e.kind === 'workspace')?.body.participation,
      { sites: ['kimi'], updatedAt: 20 });
    const preview = backupB.preview(exported);
    backupB.apply(preview.token, ['workspace:workspace']);
    assert.deepEqual(participants(b), ['kimi']);
    assert.equal(b.sync.localStateFragment().settings['amsConsole.participating'].deviceId, 'b');
    assert.equal(b.sync.localStateFragment().settings['amsConsole.participating'].updatedAt, 400);
    assert.equal(backupB.preview(exported).items[0].status, 'same');
  } finally { a.database.close(); b.database.close(); }
});

test('strict participation writes are independent, monotonic, queued and reject unopened sites', () => {
  const f = fixture('local');
  try {
    f.workspace.setSelection(['claude', 'kimi']);
    const openedVersion = f.database.state.get<any>('workspace').updatedAt;
    f.workspace.setParticipation(['kimi']);
    f.workspace.setParticipation([]);
    assert.deepEqual(participants(f), []);
    const stored = f.database.state.get<any>('workspace');
    assert.equal(stored.updatedAt, openedVersion);
    assert.equal(stored.participation.updatedAt, 101);
    assert.equal(f.sync.ready(0).some(op => op.key === 'state:workspace'), true);
    for (const [value, code] of [[['claude', 'claude'], /duplicate_site/], [['unknown'], /unknown_site/],
      [['gemini'], /invalid_site_selection/], ['kimi', /invalid_site_selection/]] as const) {
      assert.throws(() => f.workspace.setParticipation(value), code);
    }
    assert.deepEqual(participants(f), []);
  } finally { f.database.close(); }
});

test('concurrent tier and send-selection edits converge without overwriting either preference', () => {
  const a = fixture('a'), b = fixture('b');
  try {
    seed(a); b.sync.applyStateFragments({ a: a.sync.localStateFragment() });
    a.workspace.setTier('think'); b.workspace.setParticipation(['claude']);
    const cloud = { a: a.sync.localStateFragment(), b: b.sync.localStateFragment() };
    a.sync.applyStateFragments(cloud); b.sync.applyStateFragments(cloud);
    for (const device of [a, b]) {
      assert.deepEqual(participants(device), ['claude']);
      assert.equal(device.workspace.getState().tier, 'think');
    }
    a.workspace.setSelection(['kimi', 'claude']);
    assert.deepEqual(participants(a), ['claude']);
    b.sync.applyStateFragments({ a: a.sync.localStateFragment() });
    assert.deepEqual(participants(b), ['claude']);
  } finally { a.database.close(); b.database.close(); }
});

test('a closed page is excluded without losing its saved participation preference', () => {
  const f = fixture('local');
  try {
    f.workspace.setSelection(['claude', 'kimi']); f.workspace.setParticipation(['kimi']);
    f.workspace.setSelection(['claude']);
    assert.deepEqual(participants(f), []);
    f.workspace.setSelection(['claude', 'kimi']);
    assert.deepEqual(participants(f), ['kimi']);
  } finally { f.database.close(); }
});

test('editing open-page participation preserves the hidden preference of a closed page', () => {
  const f = fixture('local');
  try {
    f.workspace.setSelection(['claude', 'kimi']); f.workspace.setParticipation(['kimi']);
    f.workspace.setSelection(['claude']); f.workspace.setParticipation(['claude']);
    assert.deepEqual(participants(f), ['claude']);
    f.workspace.setSelection(['claude', 'kimi']);
    assert.deepEqual(participants(f), ['claude', 'kimi']);
  } finally { f.database.close(); }
});

test('importing a legacy workspace backup preserves the existing independent participation', () => {
  const f = fixture('local');
  try {
    seed(f);
    const service = new BackupService(f.database, { deviceId: () => 'local', now: () => 400 });
    const legacy = { format: 'polyask-backup', version: 1, exportedAt: 100, entries: [{ kind: 'workspace', id: 'workspace',
      body: { selectedSites: ['claude', 'kimi'], tier: 'think', updatedAt: 10 } }] };
    const preview = service.preview(legacy); service.apply(preview.token, ['workspace:workspace']);
    assert.deepEqual(participants(f), ['kimi']);
    assert.equal(f.sync.localStateFragment().settings['amsConsole.participating'].updatedAt, 20);
    assert.equal(f.workspace.getState().tier, 'think');
    assert.equal(service.preview(legacy).items[0].status, 'same');
  } finally { f.database.close(); }
});

test('a first malformed participation import does not fall back to sending to every open page', () => {
  const f = fixture('fresh');
  try {
    const { body } = JSON.parse(readFileSync(join(__dirname, 'fixtures/schema1-state-participation.json'), 'utf8'));
    body.settings['amsConsole.participating'].value = { 'claude.ai': 'false' };
    f.sync.applyStateFragments({ remote: body });
    assert.deepEqual(participants(f), []);
  } finally { f.database.close(); }
});
