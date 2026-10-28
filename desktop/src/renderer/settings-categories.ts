import type { DesktopCopy } from '../shared/copy';

export const SETTINGS_CATEGORIES = ['appearance', 'interaction', 'sync', 'backup', 'network', 'data', 'about'] as const;
export type SettingsCategory = typeof SETTINGS_CATEGORIES[number];
export type LegacySettingsSection = 'overview' | 'drive-diagnostics' | 'data' | 'display' | 'proxy';
export type SettingsTarget = SettingsCategory | LegacySettingsSection | 'layout' | 'connection' | 'image-sync' | 'preference-sync' | 'backup-export';
export type SettingsNavigationTarget = SettingsTarget | { category: SettingsCategory };
const TARGETS: Partial<Record<SettingsTarget, { category: SettingsCategory; id: string }>> = {
  display: { category: 'appearance', id: 'settings-display-title' },
  layout: { category: 'appearance', id: 'settings-layout-title' },
  overview: { category: 'sync', id: 'sync-title' }, connection: { category: 'sync', id: 'sync-title' },
  'drive-diagnostics': { category: 'sync', id: 'sync-diagnostics-toggle' },
  'image-sync': { category: 'sync', id: 'question-image-sync-title' },
  'preference-sync': { category: 'sync', id: 'settings-preference-sync-title' },
  proxy: { category: 'network', id: 'settings-proxy-title' },
  data: { category: 'data', id: 'settings-advanced-toggle' },
  'backup-export': { category: 'backup', id: 'backup-card-title' }
};
export function resolveSettingsTarget(target?: SettingsNavigationTarget): { category: SettingsCategory; id: string } {
  if (typeof target === 'string' && Object.hasOwn(TARGETS, target)) return TARGETS[target]!;
  const candidate = typeof target === 'object' && target ? target.category : target;
  const category = SETTINGS_CATEGORIES.includes(candidate as SettingsCategory) ? candidate as SettingsCategory : 'appearance';
  return { category, id: `settings-category-${category}` };
}
export function settingsCategoryLabels(copy: DesktopCopy): Record<SettingsCategory, string> {
  return { appearance: copy.settingsCategoryAppearance, interaction: copy.settingsCategoryInteraction,
    sync: copy.settingsCategorySync, backup: copy.settingsCategoryBackup, network: copy.settingsCategoryNetwork,
    data: copy.settingsGroupData, about: copy.settingsCategoryAbout };
}
