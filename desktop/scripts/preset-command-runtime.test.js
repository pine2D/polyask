'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { presetPage } = require('./lib/claude-presets-harness');
const plain = value => JSON.parse(JSON.stringify(value));
const original = { model: 'Original', effort: 'Medium' }, target = { model: 'Chosen', effort: 'Extra' };
function page() {
  const p = presetPage(); let value = { ...original }, reads = 0;
  const actions = [];
  p.a.currentPreset = () => null;
  p.a.readPreset = async () => { reads++; await Promise.resolve(); return { ...value }; };
  p.a.applyPreset = async preset => { actions.push({ ...preset }); value = { ...preset }; return { ...value }; };
  return { ...p, actions, value: () => value, reads: () => reads };
}

test('explicit verification obtains fresh menu-only evidence and restores the original exact pair', async () => {
  const p = page();
  try {
    const result = await p.command({ kind: 'verify', preset: target });
    assert.equal(result.ok, true); assert.deepEqual(plain(result.verified), target);
    assert.deepEqual(p.actions, [target, original]); assert.deepEqual(p.value(), original);
    assert.equal(p.reads() >= 3, true); assert.equal(p.a.currentPreset(), null);
  } finally { p.close(); }
});

test('exact tier receipts use fresh interaction evidence when closed controls omit the model', async () => {
  const p = page();
  try {
    const result = await p.S.resolveTier('fast', Date.now() + 3000, false, target);
    assert.equal(result.outcome, 'preferred'); assert.equal(result.model, 'Chosen · Extra');
    assert.equal(p.reads() > 0, true); assert.equal(p.a.currentPreset(), null);
  } finally { p.close(); }
});

test('verification never probes a model change that would navigate away from the conversation', async () => {
  const p = page(); p.a.presetModelRequiresNavigation = true;
  try {
    const result = await p.command({ kind: 'verify', preset: target });
    assert.equal(result.ok, false); assert.equal(result.code, 'preset_model_switch_required');
    assert.equal(p.actions.length, 0); assert.deepEqual(p.value(), original);
  } finally { p.close(); }
});

test('navigation during the initial interactive read prevents all selection and restore clicks', async () => {
  const p = page(); const read = p.a.readPreset;
  p.a.readPreset = async () => { const result = await read(); p.dom.reconfigure({ url: 'https://claude.ai/chat/changed' }); return result; };
  try {
    const result = await p.command({ kind: 'verify', preset: target });
    assert.equal(result.ok, false); assert.equal(result.code, 'not_ready'); assert.equal(p.actions.length, 0);
  } finally { p.close(); }
});

test('a transient unreadable target still restores and confirms the known original choice', async () => {
  const p = page(), read = p.a.readPreset;
  p.a.readPreset = async () => p.value().model === target.model ? null : read();
  try {
    const result = await p.command({ kind: 'verify', preset: target });
    assert.equal(result.ok, true); assert.deepEqual(p.value(), original);
    assert.deepEqual(p.actions, [target, original]);
  } finally { p.close(); }
});

test('same-URL navigation invalidates verification before any restore on the new page', async () => {
  const p = page(), apply = p.a.applyPreset;
  p.a.applyPreset = async preset => {
    const result = await apply(preset);
    p.dom.window.history.pushState({}, '', p.dom.window.location.href);
    p.dom.window.dispatchEvent(new p.dom.window.PopStateEvent('popstate'));
    return result;
  };
  try {
    const result = await p.command({ kind: 'verify', preset: target });
    assert.equal(result.code, 'not_ready'); assert.deepEqual(p.actions, [target]);
  } finally { p.close(); }
});

test('navigation while queued prevents even the initial read and all selection clicks', async () => {
  const p = page(); let release;
  const hold = new Promise(resolve => { release = resolve; });
  try {
    const pending = new Promise(resolve => p.S.presetCommand({ cmd: 'tierPreset', action: { kind: 'verify', preset: target },
      deadline: Date.now() + 3000 }, resolve, task => hold.then(task)));
    p.S.invalidatePreset(); release();
    assert.equal((await pending).code, 'not_ready'); assert.equal(p.actions.length, 0); assert.equal(p.reads(), 0);
  } finally { p.close(); }
});

for (const readNumber of [2, 3]) test(`navigation after awaited read ${readNumber} stops the next transaction action`, async () => {
  const p = page(), read = p.S.readPreset; let reads = 0;
  p.S.readPreset = async (...args) => {
    const value = await read(...args);
    if (++reads === readNumber) queueMicrotask(p.S.invalidatePreset);
    return value;
  };
  try {
    assert.equal((await p.command({ kind: 'verify', preset: target })).code, 'not_ready');
    assert.deepEqual(p.actions, readNumber === 2 ? [] : [target]);
  } finally { p.close(); }
});
