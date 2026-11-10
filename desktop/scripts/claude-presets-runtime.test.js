'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { presetPage } = require('./lib/claude-presets-harness');
const extra = { model: 'Fable 5.2', effort: 'Extra' };
const plain = value => JSON.parse(JSON.stringify(value));

test('reads the current exact pair without opening any menu', () => {
  const p = presetPage();
  try {
    assert.equal(typeof p.a.currentPreset, 'function');
    assert.deepEqual(plain(p.a.currentPreset()), { model: 'Fable 5.2', effort: 'Medium' });
    assert.equal(p.closes(), 0); assert.equal(p.clicks.length, 0);
  } finally { p.close(); }
});

test('discovers future names and model-dependent effort then restores the original pair', async () => {
  const p = presetPage();
  try {
    assert.equal(typeof p.a.presetOptions, 'function');
    const catalog = await p.a.presetOptions('Future 8.3', Date.now() + 10000);
    assert.deepEqual(plain(catalog.efforts), ['Balanced', 'Deep']);
    assert.equal(catalog.models.includes('Future 8.3'), true);
    assert.deepEqual(p.state, { model: 'Fable 5.2', effort: 'Medium' });
    assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('custom fast can mean a powerful model with Extra; it is not confused with Max or coarse think', async () => {
  const p = presetPage();
  try {
    const result = await p.S.resolveTier('fast', Date.now() + 5000, false, extra);
    assert.equal(result.outcome, 'preferred');
    assert.equal(result.model, 'Fable 5.2 · Extra');
    assert.equal(p.state.effort, 'Extra'); assert.equal(p.a.state(), 'think');
    assert.equal(p.clicks.includes('effort:Max'), false); assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('missing, disabled and ambiguous models fail without selecting a substitute', async () => {
  for (const options of [{}, { disabled: 'Opus 5.5' }, { duplicate: 'Opus 5.5' }]) {
    const p = presetPage(options);
    try {
      assert.equal(typeof p.a.applyPreset, 'function');
      await assert.rejects(p.a.applyPreset({ model: Object.keys(options).length ? 'Opus 5.5' : 'Missing 9', effort: 'Max' }, Date.now() + 3000));
      assert.equal(p.clicks.length, 0); assert.equal(p.menus(), 0);
    } finally { p.close(); }
  }
});

test('hidden stale entries do not create ambiguity; no-effort models return an empty effort list', async () => {
  const p = presetPage({ hidden: 'Haiku 5.5' });
  try {
    assert.equal(typeof p.a.presetOptions, 'function');
    const catalog = await p.a.presetOptions('Haiku 5.5', Date.now() + 10000);
    assert.deepEqual(plain(catalog.efforts), []);
    assert.deepEqual(p.state, { model: 'Fable 5.2', effort: 'Medium' });
  } finally { p.close(); }
});

test('verification restores the original pair and returns the exact verified target', async () => {
  const p = presetPage();
  try {
    assert.equal(typeof p.S.presetCommand, 'function');
    const result = await p.command({ kind: 'verify', preset: extra });
    assert.equal(result.ok, true); assert.deepEqual(plain(result.verified), extra);
    assert.deepEqual(p.state, { model: 'Fable 5.2', effort: 'Medium' });
    assert.equal(p.dom.window.document.querySelector('textarea').value, 'untouched draft');
    assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('failed effort verification still restores; a missing effort control is not treated as no-effort', async () => {
  for (const options of [{ ignore: 'effort:Extra' }, { missingEffort: true }]) {
    const p = presetPage(options);
    try {
      assert.equal(typeof p.S.presetCommand, 'function');
      const result = await p.command({ kind: 'verify', preset: extra });
      assert.equal(result.ok, false);
      assert.deepEqual(p.state, { model: 'Fable 5.2', effort: 'Medium' });
      assert.equal(p.menus(), 0);
    } finally { p.close(); }
  }
});

test('expired presets cannot click, and a generating page cannot be probed', async () => {
  const p = presetPage({ generating: true });
  try {
    assert.equal(typeof p.a.applyPreset, 'function');
    await assert.rejects(p.a.applyPreset(extra, Date.now() - 1));
    const result = await p.command({ kind: 'options' });
    assert.equal(result.code, 'preset_busy'); assert.equal(p.clicks.length, 0);
  } finally { p.close(); }
});


test('nested model and effort submenus retain their semantic owners', async () => {
  const p = presetPage({ submenu: true, nestedEffort: true });
  try {
    const catalog = await p.a.presetOptions('Future 8.3', Date.now() + 10000);
    assert.deepEqual(plain(catalog.efforts), ['Balanced', 'Deep']);
    await p.a.applyPreset({ model: 'Future 8.3', effort: 'Deep' }, Date.now() + 5000);
    assert.deepEqual(p.state, { model: 'Future 8.3', effort: 'Deep' });
    assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('failed restoration never returns verified success', async () => {
  const p = presetPage({ ignore: 'effort:Medium' });
  try {
    const result = await p.command({ kind: 'verify', preset: extra });
    assert.equal(result.ok, false); assert.equal(result.code, 'preset_restore_failed');
    assert.equal(p.state.effort, 'Extra'); assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('deadline reached during model change permits menu cleanup but no later effort or restore click', async () => {
  let p;
  p = presetPage({ afterClick: () => { p.dom.window.Date.now = () => Date.now() + 20000; } });
  try {
    const result = await p.command({ kind: 'verify', preset: { model: 'Opus 5.5', effort: 'Max' } });
    assert.equal(result.code, 'preset_restore_failed');
    assert.deepEqual(p.clicks, ['model:Opus 5.5']); assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('navigation during verification stops further clicks and does not restore on another conversation', async () => {
  let p;
  p = presetPage({ afterClick: () => p.dom.reconfigure({ url: 'https://claude.ai/chat/another' }) });
  try {
    const result = await p.command({ kind: 'verify', preset: { model: 'Opus 5.5', effort: 'Max' } });
    assert.equal(result.ok, false); assert.equal(result.code, 'not_ready');
    assert.deepEqual(p.clicks, ['model:Opus 5.5']);
  } finally { p.close(); }
});


test('an unavailable custom preset reports unconfirmed but submits the broadcast exactly once', async () => {
  const p = presetPage(); let submissions = 0;
  try {
    p.a.inject = (el, text) => { el.value = text; return true; };
    p.a.submit = el => { submissions++; el.value = ''; return true; };
    const result = await p.dispatch({ cmd: 'submitPrompt', tier: 'think', text: 'synthetic local question',
      images: [], preset: { model: 'Unavailable 9', effort: 'Extra' } });
    assert.equal(result.ok, true); assert.equal(result.code, 'tier_unconfirmed');
    assert.equal(result.selection.outcome, 'unconfirmed'); assert.equal(submissions, 1);
    assert.equal(p.clicks.length, 0); assert.equal(p.menus(), 0);
  } finally { p.close(); }
});

test('split effort words stay exact through verification and restoration; only known usage prose is excluded', async () => {
  const p = presetPage({ choices: { 'Fable 5.2': ['Medium', 'Extra', 'Extra High'] } });
  try {
    const b = p.dom.window.document.querySelector('[data-testid="model-selector-dropdown"]');
    p.state.effort = 'Extra High';
    b.innerHTML = '<span>Fable 5.2</span><span><span>Extra</span> <span>High</span></span>';
    b.setAttribute('aria-label', 'Model: Fable 5.2 Extra High');
    assert.deepEqual(plain(p.a.currentPreset()), { model: 'Fable 5.2', effort: 'Extra High' });
    const result = await p.command({ kind: 'verify', preset: extra });
    assert.equal(result.ok, true); assert.deepEqual(p.clicks, ['effort:Extra', 'effort:Extra High']);
    assert.equal(p.state.effort, 'Extra High');
    b.innerHTML = '<span>Fable 5.2</span><span>Extra</span><span>3.5× or more usage</span>';
    b.setAttribute('aria-label', 'Model: Fable 5.2 Extra 3.5× or more usage');
    assert.deepEqual(plain(p.a.currentPreset()), extra);
    b.innerHTML = '<span>Fable 5.2</span><span>Extra</span><span role="img" aria-label="3.5× or more usage">\ue109</span>';
    assert.deepEqual(plain(p.a.currentPreset()), extra);
    b.setAttribute('aria-label', 'Model: Fable 5.2 Extra High');
    assert.equal(p.a.currentPreset(), null);
  } finally { p.close(); }
});


test('menu-owned Escape closes a menu even when the already-selected effort needs no click', async () => {
  const p = presetPage({ scopedEscape: true, asyncEscape: true });
  try {
    const result = await p.command({ kind: 'options' });
    assert.equal(result.ok, true); assert.equal(p.menus(), 0);
    await p.a.applyPreset({ model: 'Fable 5.2', effort: 'Medium' }, Date.now() + 5000);
    assert.equal(p.menus(), 0); assert.equal(p.clicks.length, 0);
  } finally { p.close(); }
});
