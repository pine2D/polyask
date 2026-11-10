import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTierPresets } from '../src/main/tier-preset-routing';
import { sendTrackedSynthesis } from '../src/main/synthesis-generation';
import { BroadcastCoordinator } from '../src/main/broadcast';
import { DEFAULT_PREFERENCE_VALUES } from '../src/shared/preferences';
import type { SubmitSiteCommand } from '../src/shared/protocol';

const extra = { model: 'Fable 5.2', effort: 'Extra' }, max = { model: 'Opus 5.5', effort: 'Max' };
test('a dispatch captures independent exact pairs and isolates every returned value', () => {
  const values = { claudeFastPreset: { ...max }, claudeThinkPreset: { ...extra } }, preset = captureTierPresets(values);
  values.claudeThinkPreset.effort = 'Max';
  const selected = preset('claude', 'think')!;
  assert.deepEqual(selected, extra);
  Object.assign(selected, { effort: 'Low' });
  assert.deepEqual(preset('claude', 'think'), extra);
  assert.deepEqual(preset('claude', 'fast'), max);
  assert.equal(preset('claude', null), undefined); assert.equal(preset('kimi', 'think'), undefined);
  assert.equal(captureTierPresets()('claude', 'think'), undefined);
});

test('assisted sending routes the captured preset and preserves its history token across retries', async () => {
  const commands: SubmitSiteCommand[] = [], values = { ...DEFAULT_PREFERENCE_VALUES, claudeThinkPreset: { ...extra } };
  const manager = { beginGenerationRun() {}, markStatus() {}, watchGeneration() {}, confirmSubmitted: async () => null,
    sendCommand: async (_site: string, command: SubmitSiteCommand) => {
      commands.push(command); values.claudeThinkPreset.effort = 'Max';
      return commands.length === 1 ? { ok: false, code: 'composer_not_found' } : { ok: true };
    } };
  const [result] = await sendTrackedSynthesis({ sites: ['claude'], text: 'local fixture only', tier: 'think', images: [] },
    manager as any, new BroadcastCoordinator(), 5000, values);
  assert.equal(result.ok, true); assert.equal(commands.length, 2);
  assert.deepEqual(commands.map(command => command.preset), [extra, extra]);
  assert.equal(commands[0].historyToken, commands[1].historyToken);
});
