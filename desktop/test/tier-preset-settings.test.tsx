import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { TierPresetSettings } from '../src/renderer/tier-preset-settings';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../src/shared/preferences';
import { requestDecisionNavigation } from '../src/renderer/decision-navigation';
import { mountDom } from './ui/dom-harness';
const copy = getCopy('en'), extra = { model: 'Fable 5.2', effort: 'Extra' }, max = { model: 'Opus 5.5', effort: 'Max' };
const snapshot = (think: typeof extra | null = null): PreferenceSnapshot => ({ values: { ...DEFAULT_PREFERENCE_VALUES, claudeThinkPreset: think },
  following: { display: false, layout: false, siteZoom: false, proxy: false }, draftSync: false, initialized: [], deviceId: 'fixture', versions: {} });
const catalogs = (model = 'Fable 5.2') => ({ models: ['Fable 5.2', 'Opus 5.5', 'Haiku 5.5'], model,
  efforts: model === 'Haiku 5.5' ? [] : model === 'Fable 5.2' ? ['Medium', 'Extra', 'Max'] : ['Medium', 'Max'], current: extra });
function api(patch: Record<string, unknown> = {}) {
  const fixture: any = { getTierPresets: async (model?: string) => catalogs(model), getCurrentTierPreset: async () => extra,
    saveTierPreset: async (_mode: string, preset: typeof extra | null) => snapshot(preset), ...patch };
  setShellApi({ getTierPresets: (site: string, model?: string) => { assert.equal(site, 'claude'); return fixture.getTierPresets(model); },
    getCurrentTierPreset: (site: string) => { assert.equal(site, 'claude'); return fixture.getCurrentTierPreset(); },
    saveTierPreset: (site: string, mode: string, preset: unknown) => { assert.equal(site, 'claude'); return fixture.saveTierPreset(mode, preset); } } as any);
}
async function select(h: Awaited<ReturnType<typeof mountDom>>, id: string, value: string) {
  await act(async () => { const el = h.document.getElementById(id) as HTMLSelectElement;
    el.value = value; el.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
}
function button(h: Awaited<ReturnType<typeof mountDom>>, action: string, mode?: string) {
  return h.document.querySelector<HTMLButtonElement>(`${mode ? `[data-preset-mode="${mode}"] ` : ''}[data-preset-action="${action}"]`)!;
}

test('presets only read on demand and select model-dependent efforts without guessing', async () => {
  const calls: unknown[] = []; api({ getTierPresets: async (model?: string) => { calls.push(model); return catalogs(model); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot()} />);
  try {
    assert.equal(calls.length, 0); await h.click(button(h, 'refresh'));
    assert.equal(calls.length, 1);
    await select(h, 'claude-think-model', 'Opus 5.5');
    const effort = h.document.getElementById('claude-think-effort') as HTMLSelectElement;
    assert.deepEqual([...effort.options].map(option => option.value), ['', 'Medium', 'Max']);
    assert.equal(effort.value, ''); assert.equal(button(h, 'save', 'think').disabled, true);
    await select(h, 'claude-think-effort', 'Max');
    assert.equal(button(h, 'save', 'think').disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('current page choice fills only the requested draft and verification saves the exact pair once', async () => {
  const writes: unknown[] = []; let finish!: (value: PreferenceSnapshot) => void;
  api({ saveTierPreset: (mode: string, preset: unknown) => { writes.push([mode, preset]); return new Promise(resolve => { finish = resolve; }); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot()} />);
  try {
    await h.click(button(h, 'current', 'think'));
    assert.equal((h.document.getElementById('claude-think-effort') as HTMLSelectElement).value, 'Extra');
    assert.equal((h.document.getElementById('claude-fast-model') as HTMLSelectElement).value, '');
    await h.click(button(h, 'save', 'think')); await h.click(button(h, 'save', 'think'));
    assert.deepEqual(writes, [['think', extra]]);
    await act(async () => finish(snapshot(extra)));
    assert.match(h.document.querySelector('[data-preset-saved="think"]')!.textContent!, /Fable 5.2 · Extra/);
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]')!.textContent, copy.presetSaved);
  } finally { await h.close(); setShellApi(null); }
});

test('unavailable saved selections remain visible and failures keep the attempted draft', async () => {
  const missing = { model: 'Retired 4.5', effort: 'Extra' };
  api({ saveTierPreset: async () => { throw Error('preset_restore_failed'); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot(missing)} />);
  try {
    await h.click(button(h, 'refresh'));
    assert.equal((h.document.getElementById('claude-think-model') as HTMLSelectElement).value, 'Retired 4.5');
    assert.equal(button(h, 'save', 'think').disabled, true);
    await h.click(button(h, 'current', 'think')); await h.click(button(h, 'save', 'think'));
    assert.equal((h.document.getElementById('claude-think-effort') as HTMLSelectElement).value, 'Extra');
    assert.match(h.document.querySelector('[data-preset-saved="think"]')!.textContent!, /Retired 4.5/);
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]')!.textContent, copy.presetRestoreFailed);
  } finally { await h.close(); setShellApi(null); }
});

test('restore recommendation works without reading a page and unsaved drafts have a leave guard', async () => {
  const writes: unknown[] = []; api({ saveTierPreset: async (mode: string, value: unknown) => { writes.push([mode, value]); return snapshot(); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot(max)} />);
  try {
    await h.click(button(h, 'reset', 'think')); assert.deepEqual(writes, [['think', null]]);
    await h.click(button(h, 'current', 'think')); let left = false;
    await act(async () => requestDecisionNavigation(() => { left = true; }, { kind: 'surface', surface: 'sites' }));
    assert.equal(left, false); assert.equal(h.document.querySelector('[role="dialog"]') !== null, true);
    const discard = [...h.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(el => el.textContent === copy.presetDiscard)!;
    await h.click(discard); assert.equal(left, true);
  } finally { await h.close(); setShellApi(null); }
});

test('reset invalidates late menu responses and no-effort models can be saved explicitly', async () => {
  let finish!: (value: ReturnType<typeof catalogs>) => void; api({ getTierPresets: () => new Promise(resolve => { finish = resolve; }) });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot()} resetKey={0} />);
  try {
    await h.click(button(h, 'refresh'));
    await h.render(<TierPresetSettings copy={copy} snapshot={snapshot()} resetKey={1} />);
    await act(async () => finish(catalogs()));
    assert.equal((h.document.getElementById('claude-think-model') as HTMLSelectElement).options.length, 1);
    api(); await h.click(button(h, 'refresh')); await select(h, 'claude-think-model', 'Haiku 5.5');
    assert.equal(button(h, 'save', 'think').disabled, false);
    assert.equal((h.document.getElementById('claude-think-effort') as HTMLSelectElement).disabled, true);
  } finally { await h.close(); setShellApi(null); }
});

test('a late save reply cannot replace a newer synced preset or the other mode', async () => {
  for (const changedMode of ['think', 'fast'] as const) {
    let finish!: (value: PreferenceSnapshot) => void;
    api({ saveTierPreset: () => new Promise(resolve => { finish = resolve; }) });
    const initial = snapshot(), h = await mountDom(<TierPresetSettings copy={copy} snapshot={initial} />);
    try {
      await h.click(button(h, 'current', 'think')); await h.click(button(h, 'save', 'think'));
      const key = changedMode === 'think' ? 'claudeThinkPreset' : 'claudeFastPreset';
      const newer: PreferenceSnapshot = { ...initial, values: { ...initial.values, [key]: max },
        versions: { [key]: { updatedAt: 30, deviceId: 'remote' } } };
      await h.render(<TierPresetSettings copy={copy} snapshot={newer} />);
      await act(async () => finish({ ...snapshot(extra), versions: { claudeThinkPreset: { updatedAt: 20, deviceId: 'local' } } }));
      assert.match(h.document.querySelector(`[data-preset-saved="${changedMode}"]`)!.textContent!, /Opus 5.5 · Max/);
      assert.equal((h.document.getElementById('claude-think-effort') as HTMLSelectElement).value, 'Extra');
      assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]')!.textContent,
        changedMode === 'think' ? copy.presetChanged : copy.presetSaved);
    } finally { await h.close(); setShellApi(null); }
  }
});

test('an unchanged preset cannot be saved again after options are loaded', async () => {
  let writes = 0; api({ saveTierPreset: async () => { writes++; return snapshot(extra); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot(extra)} />);
  try {
    await h.click(button(h, 'refresh'));
    assert.equal(button(h, 'save', 'think').disabled, true);
    await h.click(button(h, 'save', 'think'));
    assert.equal(writes, 0);
    await select(h, 'claude-think-effort', 'Max');
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-dirty]') !== null, true);
    assert.equal(button(h, 'save', 'think').disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('filling an already saved webpage choice does not ask for a disabled save', async () => {
  let writes = 0; api({ saveTierPreset: async () => { writes++; return snapshot(extra); } });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot(extra)} />);
  try {
    await h.click(button(h, 'current', 'think'));
    assert.equal(button(h, 'save', 'think').disabled, true);
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-dirty]') === null, true);
    assert.match(h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]')!.textContent!, /already matches/i);
    assert.equal(writes, 0);
  } finally { await h.close(); setShellApi(null); }
});

test('save progress and a failed result stay next to the affected tier and preserve its draft', async () => {
  let reject!: (error: Error) => void;
  api({ saveTierPreset: () => new Promise((_resolve, fail) => { reject = fail; }) });
  const announcements: string[] = [];
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot()} onFeedback={message => announcements.push(message)} />);
  try {
    await h.click(button(h, 'current', 'think'));
    await h.click(button(h, 'save', 'think'));
    const notice = () => h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]');
    assert.equal(notice()?.getAttribute('data-tone'), 'progress');
    assert.match(notice()?.textContent ?? '', /verif/i);
    assert.equal(h.document.querySelector('[data-preset-mode=fast] [data-preset-feedback]')?.textContent, '');
    await act(async () => reject(new Error('database_unavailable')));
    assert.equal(notice()?.getAttribute('data-tone'), 'error');
    assert.match(notice()?.textContent ?? '', /sav/i);
    assert.doesNotMatch(notice()?.textContent ?? '', /read or verify/i);
    assert.equal((h.document.getElementById('claude-think-effort') as HTMLSelectElement).value, 'Extra');
    assert.match(h.document.querySelector('[data-preset-saved=think]')!.textContent!, /recommendation/i);
    assert.match(announcements.at(-1) ?? '', /Think/);
    assert.equal(button(h, 'save', 'think').disabled, false);
  } finally { await h.close(); setShellApi(null); }
});

test('a completed save focuses its tier when the unchanged save button becomes disabled', async () => {
  let finish!: (value: PreferenceSnapshot) => void;
  api({ saveTierPreset: () => new Promise(resolve => { finish = resolve; }) });
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={snapshot()} />);
  try {
    await h.click(button(h, 'current', 'think'));
    button(h, 'save', 'think').focus(); await h.click(button(h, 'save', 'think'));
    await act(async () => finish(snapshot(extra)));
    assert.equal(button(h, 'save', 'think').disabled, true);
    assert.equal(h.document.activeElement?.id, 'claude-think-title');
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-dirty]') === null, true);
  } finally { await h.close(); setShellApi(null); }
});
