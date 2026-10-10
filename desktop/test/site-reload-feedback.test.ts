import assert from 'node:assert/strict';
import test from 'node:test';
import { reloadSiteWithFeedback } from '../src/renderer/site-reload';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy, formatCopy } from '../src/shared/copy';
import { readSource } from './fixtures';

const copy = getCopy('en');
const sites = [{ key: 'claude', label: 'Claude' }] as any;

test('frame reload reports a false result and a thrown rejection instead of staying silent', async () => {
  const said: string[] = [];
  setShellApi({ reloadSite: async () => false } as any);
  await reloadSiteWithFeedback('claude', copy, sites, text => said.push(text));
  setShellApi({ reloadSite: async () => { throw new Error('ipc'); } } as any);
  await reloadSiteWithFeedback('claude', copy, sites, text => said.push(text));
  setShellApi({ reloadSite: async () => true } as any);
  await reloadSiteWithFeedback('claude', copy, sites, text => said.push(text));
  setShellApi(null);
  assert.deepEqual(said, [formatCopy(copy.healthReloadRejected, { site: 'Claude' }), copy.workspaceActionFailed,
    formatCopy(copy.healthReloaded, { site: 'Claude' })]);
});

test('the shell wires the frame reload button through the feedback helper, not a bare void call', () => {
  const source = readSource('src/renderer/index.tsx');
  assert.equal(source.includes('void shell.reloadSite('), false);
  assert.equal(source.includes('reloadSiteWithFeedback('), true);
});

test('persistence failures use the generic preference-save copy, not the display-only message', () => {
  const source = readSource('src/renderer/index.tsx');
  const hook = source.slice(source.indexOf('useSyncedPreferences({'), source.indexOf('useSyncedPreferences({') + 240);
  assert.equal(hook.includes('displayPreferencesFailed'), false);
  assert.equal(hook.includes('preferencesSaveFailed'), true);
  for (const locale of ['en', 'zh-CN', 'zh-TW'] as const) assert.notEqual(getCopy(locale).preferencesSaveFailed, getCopy(locale).displayPreferencesFailed);
});
