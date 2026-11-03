import assert from 'node:assert/strict';
import test from 'node:test';
import { getCopy } from '../src/shared/copy';
import { tierChangeAction } from '../src/renderer/tier-change-action';
import { ExclusiveActionLock } from '../src/renderer/broadcast-flow-state';
import { SITES } from '../src/main/sites';

test('tier action uses the shared lock and reports unconfirmed sites without changing send status', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const copy = getCopy(locale), lock = new ExclusiveActionLock(), announcements: string[] = [];
    let release!: () => void, pending!: Promise<void>, calls = 0;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const change = tierChangeAction({ copy, sites: SITES, announce: text => announcements.push(text),
      run: action => pending = lock.run(action).then(() => {}),
      change: async () => { calls++; await wait; return [{ site: 'claude', ok: true }, { site: 'kimi', ok: false, code: 'timeout' }]; } });
    change('think'); const first = pending;
    assert.equal(lock.busy, true); change('fast');
    assert.equal(calls, 1); assert.equal(announcements.length, 1);
    release(); await first;
    assert.equal(lock.busy, false); assert.equal(announcements.length, 2);
    assert.ok(announcements[1].includes('Kimi'));
    assert.equal(announcements[1].includes('{'), false);
    const follow = tierChangeAction({ copy, sites: SITES, announce: text => announcements.push(text),
      run: async action => { await action(); }, change: async tier => { assert.equal(tier, null); return []; } });
    follow(null); await Promise.resolve(); await Promise.resolve();
    assert.equal(announcements.at(-1), copy.tierFollowing);
  }
});
