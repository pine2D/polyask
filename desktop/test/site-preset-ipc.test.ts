import assert from 'node:assert/strict';
import test from 'node:test';
import { SITE_KEYS } from '../src/shared/contracts';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../src/shared/preferences';
import { OperationGate } from '../src/shared/operation-gate';
import { registerTierPresetsIpc } from '../src/main/tier-presets-ipc';

function setup() {
  const handlers = new Map<string, Function>(), seen: string[] = [], writes: string[] = [];
  let snapshot: PreferenceSnapshot = { values: structuredClone(DEFAULT_PREFERENCE_VALUES), following: { display: false, layout: false, siteZoom: false, proxy: false },
    initialized: [], versions: {}, deviceId: 'local', draftSync: false };
  const dispose = registerTierPresetsIpc({ ipc: { handle: (name, handler) => { handlers.set(name, handler); }, removeHandler: name => { handlers.delete(name); } },
    trusted: sender => sender === 'shell' as any, blocked: () => false, epoch: () => 0, gate: new OperationGate(),
    preferences: { snapshot: () => snapshot, set: (key, value) => { writes.push(key); snapshot = { ...snapshot, values: { ...snapshot.values, [key]: value } }; return snapshot; } },
    inspect: (async (site: string, action: any, deadline: number) => {
      seen.push(site); assert.ok(deadline > Date.now()); const current = { model: `${site} exact`, effort: null };
      return { ok: true, current, ...(action.kind === 'verify' ? { verified: action.preset } : {}),
        ...(action.kind === 'options' ? { catalog: { models: [current.model], model: current.model, efforts: [], current, primary: 'mode' } } : {}) };
    }) as any });
  return { seen, writes, dispose, invoke: (action: string, value: unknown, sender = 'shell') => Promise.resolve().then(() => {
    const handler = handlers.get(`polyask:tier-preset-${action}`); assert.equal(typeof handler, 'function'); return handler!(sender, value);
  }) };
}

test('site preset IPC routes the requested site and writes only that site and mode', async () => {
  const f = setup();
  try {
    for (const site of SITE_KEYS) {
      const current = await f.invoke('current', site);
      assert.equal(current.model, `${site} exact`);
      assert.equal((await f.invoke('options', { site })).primary, 'mode');
      const result = await f.invoke('save', { site, mode: 'think', preset: current });
      assert.deepEqual(Reflect.get(result.values, `${site}ThinkPreset`), current);
      assert.equal(Reflect.get(result.values, `${site}FastPreset`), null);
      assert.deepEqual(f.seen.slice(-3), [site, site, site]);
    }
    assert.deepEqual(f.writes, SITE_KEYS.map(site => `${site}ThinkPreset`));
  } finally { f.dispose(); }
});

test('unknown sites and extra fields cannot invoke a view or write preferences', async () => {
  const f = setup();
  try {
    await assert.rejects(f.invoke('current', 'kimi', 'site'), /untrusted_sender/);
    for (const site of ['unknown', '__proto__', {}, null]) {
      await assert.rejects(f.invoke('current', site), /invalid_request/);
      await assert.rejects(f.invoke('options', { site }), /invalid_request/);
      await assert.rejects(f.invoke('save', { site, mode: 'fast', preset: null }), /invalid_request/);
    }
    await assert.rejects(f.invoke('options', { site: 'kimi', bypass: true }), /invalid_request/);
    await assert.rejects(f.invoke('save', { site: 'kimi', mode: 'fast', preset: null, bypass: true }), /invalid_request/);
    assert.equal(f.seen.length, 0); assert.equal(f.writes.length, 0);
    await f.invoke('save', { site: 'kimi', mode: 'fast', preset: null });
    assert.deepEqual(f.writes, ['kimiFastPreset']); assert.equal(f.seen.length, 0);
  } finally { f.dispose(); }
});
