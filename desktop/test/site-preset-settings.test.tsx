import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { useTierPresets } from '../src/renderer/use-tier-presets';
import { TierPresetSettings } from '../src/renderer/tier-preset-settings';
import { setShellApi } from '../src/renderer/shell-api';
import { getCopy } from '../src/shared/copy';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../src/shared/preferences';
import { presetKey, type PresetMode, type TierPreset } from '../src/shared/tier-presets';
import type { SiteKey } from '../src/shared/contracts';
import { mountDom } from './ui/dom-harness';
const copy = getCopy('en');
const snapshot = (): PreferenceSnapshot => ({ values: { ...DEFAULT_PREFERENCE_VALUES, claudeThinkPreset: { model: 'Fable 5.2', effort: 'Extra' } },
  following: { display: false, layout: false, siteZoom: false, proxy: false }, draftSync: false, initialized: [], versions: {}, deviceId: 'fixture' });
const current = (site: SiteKey): TierPreset => site === 'deepseek' ? { model: 'DeepThink', effort: 'Off' } :
  site === 'doubao' ? { model: '快速', effort: null } : { model: 'Fable 5.2', effort: 'Extra' };
function api() {
  let state = snapshot(); const writes: unknown[] = [], reads: SiteKey[] = [];
  setShellApi({ getCurrentTierPreset: async (site: SiteKey) => current(site),
    getTierPresets: async (site: SiteKey, model?: string) => {
      reads.push(site); const value = current(site);
      return { model: model ?? value.model, models: [value.model], efforts: site === 'deepseek' ? ['Off', 'On'] : site === 'doubao' ? [] : ['Extra', 'Max'], current: value,
        primary: site === 'deepseek' ? 'feature' : site === 'doubao' ? 'mode' : 'model', secondary: site === 'deepseek' ? 'toggle' : 'effort' };
    }, saveTierPreset: async (site: SiteKey, mode: PresetMode, preset: TierPreset | null) => {
      writes.push([site, mode, preset]); state = { ...state, values: { ...state.values, [presetKey(site, mode)]: preset } }; return state;
    }
  } as any); return { state: () => state, writes, reads };
}
async function select(h: Awaited<ReturnType<typeof mountDom>>, id: string, value: string) {
  await act(async () => { const node = h.document.getElementById(id) as HTMLSelectElement;
    assert.equal(node === null, false, `select ${id}`); node.value = value; node.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
}
const button = (h: Awaited<ReturnType<typeof mountDom>>, action: string, mode = 'think') =>
  h.document.querySelector<HTMLButtonElement>(`${action === 'refresh' ? '' : `[data-preset-mode="${mode}"] `}[data-preset-action="${action}"]`)!;

test('site selection keeps each exact preset independent and saving touches only its site and mode', async () => {
  const f = api(), h = await mountDom(<TierPresetSettings copy={copy} snapshot={f.state()} />);
  try {
    await select(h, 'tier-preset-site', 'deepseek'); assert.equal(f.reads.length, 0);
    await h.click(button(h, 'current')); await select(h, 'deepseek-think-effort', 'On'); await h.click(button(h, 'save'));
    assert.deepEqual(f.writes, [['deepseek', 'think', { model: 'DeepThink', effort: 'On' }]]);
    assert.deepEqual(f.state().values.claudeThinkPreset, { model: 'Fable 5.2', effort: 'Extra' });
    assert.equal(f.state().values.deepseekFastPreset, null);
    await h.render(<TierPresetSettings copy={copy} snapshot={f.state()} />);
    await select(h, 'tier-preset-site', 'claude');
    assert.match(h.document.querySelector('[data-preset-saved="think"]')!.textContent!, /Fable 5.2/);
    assert.equal((h.document.getElementById('claude-think-model') as HTMLSelectElement).disabled, true);
  } finally { await h.close(); setShellApi(null); }
});
test('switching sites asks about dirty choices and cancellation preserves the active site', async () => {
  const f = api(), h = await mountDom(<TierPresetSettings copy={copy} snapshot={f.state()} />);
  try {
    await h.click(button(h, 'current', 'fast')); await select(h, 'tier-preset-site', 'doubao');
    assert.equal((h.document.getElementById('tier-preset-site') as HTMLSelectElement).value, 'claude');
    assert.equal(h.document.querySelector('[role="dialog"]') === null, false);
    const byText = (text: string) => [...h.document.querySelectorAll('button')].find(node => node.textContent === text)!;
    await h.click(byText(copy.presetKeepEditing));
    assert.equal((h.document.getElementById('claude-fast-model') as HTMLSelectElement).value, 'Fable 5.2');
    await select(h, 'tier-preset-site', 'doubao'); await h.click(byText(copy.presetDiscard));
    assert.equal((h.document.getElementById('tier-preset-site') as HTMLSelectElement).value, 'doubao'); assert.equal(f.writes.length, 0);
  } finally { await h.close(); setShellApi(null); }
});
test('mode-only and toggle capabilities render their actual semantics', async () => {
  const f = api(), h = await mountDom(<TierPresetSettings copy={getCopy('zh-CN')} snapshot={f.state()} />);
  try {
    await select(h, 'tier-preset-site', 'doubao'); await h.click(button(h, 'refresh'));
    assert.match(h.document.querySelector('label[for="doubao-think-model"]')!.textContent!, /模式/);
    assert.equal(h.document.getElementById('doubao-think-effort') === null, true);
    await select(h, 'tier-preset-site', 'deepseek'); await h.click(button(h, 'refresh'));
    assert.match(h.document.querySelector('label[for="deepseek-think-model"]')!.textContent!, /功能/);
    await h.click(button(h, 'current'));
    const effort = h.document.getElementById('deepseek-think-effort') as HTMLSelectElement;
    assert.deepEqual([...effort.options].filter(option => option.value).map(option => option.textContent), ['关闭', '开启']);
  } finally { await h.close(); setShellApi(null); }
});

test('late catalog replies cannot repopulate a different site after a context change', async () => {
  let finish!: (value: unknown) => void, form!: ReturnType<typeof useTierPresets>;
  const state = snapshot();
  setShellApi({ getTierPresets: () => new Promise(resolve => { finish = resolve; }) } as any);
  function Probe({ site }: { site: SiteKey }) { form = useTierPresets({ copy, snapshot: state }, site); return <div>{form.notice?.text}</div>; }
  const h = await mountDom(<Probe site="claude" />);
  try {
    await act(async () => { void form.refresh(); });
    await h.render(<Probe site="deepseek" />);
    await act(async () => finish({ model: 'Fable 5.2', models: ['Fable 5.2'], efforts: ['Extra'], current: current('claude') }));
    assert.equal(form.models, null); assert.equal(form.pending, null); assert.equal(form.notice, null); assert.equal(form.saved.think, null);
  } finally { await h.close(); setShellApi(null); }
});
test('Kimi refresh retains the current catalog when a saved other-model preset needs manual selection', async () => {
  const initial = snapshot(), state = { ...initial, values: { ...initial.values, kimiFastPreset: { model: 'Other Kimi', effort: 'Max' } } };
  setShellApi({ getTierPresets: async (_site: SiteKey, model?: string) => {
    if (model === 'Other Kimi') throw Error('preset_model_switch_required');
    return { model: 'Kimi current', models: ['Kimi current', 'Other Kimi'], efforts: ['High', 'Max'], current: { model: 'Kimi current', effort: 'High' } };
  } } as any);
  const h = await mountDom(<TierPresetSettings copy={copy} snapshot={state} />);
  try {
    await select(h, 'tier-preset-site', 'kimi'); await h.click(button(h, 'refresh'));
    const choice = h.document.getElementById('kimi-fast-model') as HTMLSelectElement;
    assert.deepEqual([...choice.options].map(option => option.value), ['', 'Kimi current', 'Other Kimi']);
    assert.equal(button(h, 'save', 'fast').disabled, true);
    await select(h, 'kimi-think-model', 'Other Kimi');
    assert.equal(h.document.querySelector('[data-preset-mode=think] [data-preset-feedback]')!.textContent, copy.presetModelSwitchRequired);
  } finally { await h.close(); setShellApi(null); }
});
