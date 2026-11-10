import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { setShellApi } from '../../src/renderer/shell-api';
import { getCopy } from '../../src/shared/copy';
import { DEFAULT_PREFERENCE_VALUES, type PreferenceSnapshot } from '../../src/shared/preferences';
import { claudePresetKey, type PresetMode, type TierPreset } from '../../src/shared/tier-presets';
import { proxyShellStubs } from './proxy-state-fixture';
import { desktopToolsShellStubs } from './desktop-tools-fixture';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const locale = new URLSearchParams(location.search).get('locale') || 'zh-CN', copy = getCopy(locale);
document.documentElement.lang = locale; document.documentElement.dataset.density = 'compact';
const status = { state: 'idle', connected: false, pending: 0, errorCount: 0, readOnly: false, oauthConfigured: false, secureTokenStorage: true } as const;
const runtime = { version: '1.32.0-fixture', distribution: 'installed' } as const;
let preferences: PreferenceSnapshot = { values: structuredClone(DEFAULT_PREFERENCE_VALUES), deviceId: 'synthetic',
  following: { display: false, layout: false, siteZoom: false, proxy: false }, draftSync: false, initialized: [], versions: {} };
let fail = false, hold = false, release: (() => void) | undefined, calls = 0, publish = (_value: PreferenceSnapshot) => {};
setShellApi({ ...proxyShellStubs(), ...desktopToolsShellStubs(),
  commandPaletteShortcutState: async () => ({ mode: 'standard', revision: 0 }), onCommandPaletteShortcut: () => () => {},
  globalPromptShortcutState: async () => ({ accelerator: null, activeAccelerator: null, status: 'disabled' }),
  cancelBackup: async () => {}, syncDiagnostics: async () => createSyncDiagnosticSnapshot(status, runtime),
  getLocalDataStats: async () => ({ history: 0, archives: 0, decisions: 0, folders: 0, answers: 0, memberships: 0,
    drafts: 0, reset: { preferences: 0, answers: 0, memberships: 0, templates: 0, groups: 0, workspace: 0 } }),
  getCurrentClaudePreset: async () => ({ model: 'Fable 5.2', effort: 'Extra' }),
  getClaudePresets: async (model = 'Fable 5.2') => ({ model, models: ['Fable 5.2', 'Opus 5.5', 'Haiku 5.5'],
    efforts: model === 'Haiku 5.5' ? [] : model === 'Opus 5.5' ? ['Medium', 'High', 'Max'] : ['Low', 'Medium', 'High', 'Extra', 'Max'],
    current: { model: 'Fable 5.2', effort: 'Extra' } }),
  saveClaudePreset: async (mode: PresetMode, value: TierPreset | null) => {
    calls++; if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (fail) { fail = false; throw Error('preset_restore_failed'); }
    preferences = { ...preferences, values: { ...preferences.values, [claudePresetKey(mode)]: value } };
    publish(preferences); return preferences;
  }
} as any);
function App() {
  const [snapshot, setSnapshot] = useState(preferences); publish = setSnapshot;
  return <SettingsWorkspace copy={copy} locale={locale} status={status} runtime={runtime} initialSection="model-presets"
    onStatus={() => {}} onAnnounce={message => { document.body.dataset.announcement = message; }} onClose={() => { document.body.dataset.closed = 'true'; }}
    preferenceSync={{ snapshot, onFollowingChange: async () => {}, onLayoutModeChange: async () => {}, onDraftSyncChange: async () => {} }} />;
}
(window as any).tierPresetFixture = { copy, fail: () => { fail = true; }, hold: () => { hold = true; }, release: () => { hold = false; release?.(); },
  calls: () => calls, saved: () => preferences.values };
createRoot(document.getElementById('root')!).render(<App />);
