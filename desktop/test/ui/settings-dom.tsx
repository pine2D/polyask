import React, { type ComponentProps } from 'react';
import { SettingsWorkspace } from '../../src/renderer/settings-workspace';
import { getCopy } from '../../src/shared/copy';
import { SETTINGS_RECOVERY_COPY } from '../../src/shared/settings-recovery-copy';
import type { DisplayPreferences } from '../../src/shared/display';
import { createSyncDiagnosticSnapshot } from '../../src/shared/sync-diagnostics';
import type { SyncStatus } from '../../src/shared/sync';
import { setShellApi } from '../../src/renderer/shell-api';
import { mountDom } from './dom-harness';

export const settingsCopy = { ...getCopy('en'), ...SETTINGS_RECOVERY_COPY.en };
export const settingsStatus: SyncStatus = { state: 'idle', connected: true, pending: 0, errorCount: 0,
  readOnly: false, oauthConfigured: true, secureTokenStorage: true };
export const settingsRuntime = { version: '1.14.0', distribution: 'installed' } as const;
type Props = Omit<ComponentProps<typeof SettingsWorkspace>, 'initialSection'> & {
  display?: DisplayPreferences;
  onDisplayChange?: (value: DisplayPreferences) => Promise<void>;
  initialSection?: 'overview' | 'drive-diagnostics' | 'data' | 'display';
  sectionRequest?: number;
  onBlockingChange?: (blocking: boolean) => void;
};
const noop = () => {};
export function settingsElement(patch: Partial<Props> = {}) {
  const props: Props = { copy: settingsCopy, locale: 'en', runtime: settingsRuntime, status: settingsStatus,
    onStatus: noop, onAnnounce: noop, onClose: noop, ...patch };
  return <SettingsWorkspace {...props as ComponentProps<typeof SettingsWorkspace>} />;
}
export function settingsShell(patch: Record<string, unknown> = {}) {
  setShellApi({ syncDiagnostics: async () => createSyncDiagnosticSnapshot(settingsStatus, settingsRuntime),
    getLocalDataStats: async () => ({ history: 2, archives: 3, decisions: 4, folders: 5, answers: 7, memberships: 9,
      reset: { answers: 8, memberships: 10, templates: 6, groups: 1, workspace: 1 } }), ...patch } as any);
}
export async function mountSettings(patch: Partial<Props> = {}) {
  settingsShell();
  const h = await mountDom(settingsElement(patch));
  return { ...h, close: async () => { await h.close(); setShellApi(null); } };
}
export function settingsButton(doc: Document, text: string) {
  return [...doc.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
}
