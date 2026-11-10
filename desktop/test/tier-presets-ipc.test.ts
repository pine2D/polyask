import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTierPresetsIpc } from '../src/main/tier-presets-ipc';
import { OperationGate } from '../src/shared/operation-gate';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../src/shared/preferences';
import type { TierPresetAction, TierPresetResult } from '../src/shared/tier-presets';
const original = { model: 'Fable 5.2', effort: 'Medium' }, extra = { model: 'Fable 5.2', effort: 'Extra' };
function setup() {
  const handlers = new Map<string, Function>(), gate = new OperationGate(), writes: unknown[] = [], actions: TierPresetAction[] = [];
  let epoch = 0, blocked = false, response: TierPresetResult | null = null, release: (() => void) | undefined;
  let wait: Promise<void> | undefined;
  const snapshot: PreferenceSnapshot = { values: structuredClone(DEFAULT_PREFERENCE_VALUES), following: { display: false, layout: false, siteZoom: false, proxy: false },
    initialized: [], versions: {}, deviceId: 'local', draftSync: false };
  const dispose = registerTierPresetsIpc({ ipc: { handle: (name, handler) => { handlers.set(name, handler); }, removeHandler: name => { handlers.delete(name); } },
    trusted: event => event === 'shell' as any, gate, blocked: () => blocked, epoch: () => epoch,
    preferences: { snapshot: () => structuredClone(snapshot), set: (key, value) => { writes.push([key, value]); return snapshot; } },
    inspect: async (site, action, deadline) => { assert.equal(site, 'claude'); assert.ok(deadline > Date.now()); actions.push(action); await wait;
      return response || { ok: true, current: original, ...(action.kind === 'verify' ? { verified: action.preset } : {}) }; }
  });
  return { handlers, gate, writes, actions, snapshot, dispose,
    invoke: (name: string, value?: unknown, sender = 'shell') => Promise.resolve().then(() => handlers.get(`polyask:tier-preset-${name}`)!(sender, name === 'current' ? 'claude' : name === 'options' ? { site: 'claude', model: value } : { site: 'claude', ...(value as object) })),
    block: () => { blocked = true; }, reset: () => { epoch++; }, response: (value: TierPresetResult) => { response = value; },
    pause: () => { wait = new Promise<void>(resolve => { release = resolve; }); }, resume: () => release?.() };
}

test('preset IPC checks sender, payload and operation gate before reading the site', async () => {
  const f = setup();
  try {
    await assert.rejects(f.invoke('save', { mode: 'think', preset: extra }, 'site'), /untrusted_sender/);
    for (const value of [{ mode: 'other', preset: extra }, { mode: 'think', preset: { ...extra, effort: 'x'.repeat(25) } },
      { mode: 'think', preset: extra, bypass: true }]) await assert.rejects(f.invoke('save', value), /invalid_request/);
    assert.equal(f.actions.length, 0); f.pause();
    const pending = f.invoke('save', { mode: 'think', preset: extra }); await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(f.invoke('current'), /operation_busy/);
    assert.equal(f.writes.length, 0); f.resume(); await pending;
    assert.deepEqual(f.writes, [['claudeThinkPreset', extra]]); assert.equal(f.gate.busy, false);
    f.block(); await assert.rejects(f.invoke('current'), /preset_busy/);
  } finally { f.resume(); f.dispose(); }
});

test('failed or wrong verification never saves, while restoring defaults needs no live page', async () => {
  for (const response of [{ ok: false, code: 'preset_restore_failed' }, { ok: true, current: original },
    { ok: true, current: original, verified: { model: 'Fable 5.2', effort: 'Max' } }] as TierPresetResult[]) {
    const f = setup();
    try {
      f.response(response);
      await assert.rejects(f.invoke('save', { mode: 'fast', preset: extra }));
      assert.equal(f.writes.length, 0);
      await f.invoke('save', { mode: 'fast', preset: null });
      assert.deepEqual(f.writes, [['claudeFastPreset', null]]); assert.equal(f.actions.length, 1);
    } finally { f.dispose(); }
  }
});

test('reset, sync conflict and disposed window invalidate an in-flight save', async () => {
  for (const change of [(f: ReturnType<typeof setup>) => f.reset(),
    (f: ReturnType<typeof setup>) => { f.snapshot.versions.claudeThinkPreset = { updatedAt: 99, deviceId: 'remote' }; },
    (f: ReturnType<typeof setup>) => f.dispose()]) {
    const f = setup(); f.pause();
    try {
      const pending = f.invoke('save', { mode: 'think', preset: extra }); await new Promise(resolve => setImmediate(resolve));
      change(f); f.resume(); await assert.rejects(pending); assert.equal(f.writes.length, 0);
    } finally { f.resume(); f.dispose(); }
  }
});

test('option results must correspond to the requested model and may not substitute another one', async () => {
  const f = setup();
  try {
    f.response({ ok: true, current: original, catalog: { current: original, model: original.model, models: [original.model], efforts: ['Medium'] } });
    await assert.rejects(f.invoke('options', 'Opus 5.5'), /invalid_response/);
    const catalog = await f.invoke('options'); assert.equal(catalog.model, original.model);
    assert.deepEqual(await f.invoke('current'), original);
  } finally { f.dispose(); }
});
