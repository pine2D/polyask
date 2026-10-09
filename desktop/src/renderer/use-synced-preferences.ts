import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplayPreferences } from '../shared/display';
import type { PreferenceGroup, PreferenceKey, PreferenceSnapshot, PreferenceValues, WorkbenchGuideState } from '../shared/preferences';
import { COMPLETION_NOTIFICATIONS_KEY, saveCompletionNotifications } from './completion-notification-preference';
import { readLocalUiPreferences, writeWorkbenchGuidePreference, type LocalUiStorage } from './local-ui-preferences';
import { shell } from './shell-api';

export interface SyncedPreferencesOptions {
  readonly display: DisplayPreferences;
  readonly onDisplay: (display: DisplayPreferences) => void;
  readonly onPersistenceFailure: () => void;
  readonly storage?: LocalUiStorage;
}

export interface PreferenceSyncSettingsState {
  readonly snapshot: PreferenceSnapshot | null;
  readonly onFollowingChange: (group: PreferenceGroup, enabled: boolean) => Promise<void>;
  readonly onLayoutModeChange: (mode: PreferenceValues['layoutMode']) => Promise<void>;
  readonly onDraftSyncChange: (enabled: boolean) => Promise<void>;
}

function legacyValues(storage: LocalUiStorage, display: DisplayPreferences): Partial<PreferenceValues> {
  const local = readLocalUiPreferences(storage, display);
  const values: { display: DisplayPreferences; completionNotifications?: boolean; workbenchGuide?: WorkbenchGuideState } = { display: local.display };
  // Missing old shared values are not user choices: do not timestamp defaults
  // that could later defeat an existing choice on a newly connected device.
  try {
    const notification = storage.getItem(COMPLETION_NOTIFICATIONS_KEY);
    if (notification === 'true' || notification === 'false') values.completionNotifications = notification === 'true';
  } catch { /* Shared values remain available from the database. */ }
  if (local.workbenchGuide) values.workbenchGuide = local.workbenchGuide;
  return values;
}

function mirrorSharedValues(storage: LocalUiStorage, next: PreferenceSnapshot): boolean {
  try {
    const notification = storage.getItem(COMPLETION_NOTIFICATIONS_KEY);
    if (next.initialized.includes('completionNotifications')) {
      if (notification !== String(next.values.completionNotifications)) {
        storage.setItem(COMPLETION_NOTIFICATIONS_KEY, String(next.values.completionNotifications));
      }
    } else if (notification !== null) {
      if (storage.removeItem) storage.removeItem(COMPLETION_NOTIFICATIONS_KEY);
      else storage.setItem(COMPLETION_NOTIFICATIONS_KEY, '');
    }
    const guide = next.initialized.includes('workbenchGuide') ? next.values.workbenchGuide : null;
    const previous = readLocalUiPreferences(storage, next.values.display).workbenchGuide;
    return JSON.stringify(previous) === JSON.stringify(guide) || writeWorkbenchGuidePreference(storage, guide, next.values.display);
  } catch { return false; }
}

/** Database pushes own accepted state; localStorage is only a migration source. */
export function useSyncedPreferences(options: SyncedPreferencesOptions) {
  const latest = useRef(options); latest.current = options;
  const [snapshot, setSnapshot] = useState<PreferenceSnapshot | null>(null);
  const revision = useRef(0), lifecycle = useRef(0), mounted = useRef(false), lastDisplay = useRef(options.display);
  const [legacy] = useState(() => legacyValues(options.storage ?? window.localStorage, options.display));
  const [localNotifications, setLocalNotifications] = useState(legacy.completionNotifications ?? false);
  const accept = useCallback((next: PreferenceSnapshot) => {
    if (!mounted.current) return;
    revision.current++;
    setSnapshot(next);
    if (next.values.display.density !== lastDisplay.current.density || next.values.display.siteScale !== lastDisplay.current.siteScale) {
      lastDisplay.current = next.values.display;
      latest.current.onDisplay(next.values.display);
    }
    if (!mirrorSharedValues(latest.current.storage ?? window.localStorage, next)) latest.current.onPersistenceFailure();
  }, []);
  const run = useCallback(async (action: () => Promise<PreferenceSnapshot>): Promise<void> => {
    const request = ++revision.current;
    try {
      const next = await action();
      if (mounted.current && request === revision.current) accept(next);
    } catch (error) {
      if (mounted.current) latest.current.onPersistenceFailure();
      throw error;
    }
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    const generation = ++lifecycle.current;
    if (typeof shell.onPreferences !== 'function' || typeof shell.getPreferences !== 'function' || typeof shell.seedPreferences !== 'function') {
      return () => { mounted.current = false; revision.current++; lifecycle.current++; };
    }
    const unsubscribe = shell.onPreferences(accept);
    const initialize = async () => {
      try {
        const initial = await shell.getPreferences();
        if (!mounted.current || generation !== lifecycle.current) return;
        const seed = { ...legacy };
        if (initial.initialized.includes('completionNotifications')) delete seed.completionNotifications;
        if (initial.initialized.includes('workbenchGuide')) delete seed.workbenchGuide;
        const request = revision.current;
        const next = await shell.seedPreferences(seed);
        if (mounted.current && generation === lifecycle.current && request === revision.current) accept(next);
      } catch {
        if (mounted.current && generation === lifecycle.current) latest.current.onPersistenceFailure();
      }
    };
    void initialize();
    return () => { mounted.current = false; revision.current++; lifecycle.current++; unsubscribe(); };
  }, [accept, legacy]);
  const setPreference = useCallback((key: PreferenceKey, value: unknown) => run(() => shell.setPreference(key, value)), [run]);
  const onCompletionNotifications = useCallback(async (enabled: boolean): Promise<void> => {
    if (typeof shell.setPreference === 'function') {
      try { await setPreference('completionNotifications', enabled); } catch { /* Central persistence feedback owns the failure. */ }
    } else {
      if (typeof shell.setCompletionNotifications === 'function') shell.setCompletionNotifications(enabled);
      const storage = latest.current.storage ?? window.localStorage;
      if (!saveCompletionNotifications(storage as Storage, enabled)) latest.current.onPersistenceFailure();
      setLocalNotifications(enabled);
    }
  }, [setPreference]);
  const onFollowingChange = useCallback((group: PreferenceGroup, enabled: boolean) => run(() => shell.followPreferences(group, enabled)), [run]);
  const onLayoutModeChange = useCallback((mode: PreferenceValues['layoutMode']) => setPreference('layoutMode', mode), [setPreference]);
  const onDraftSyncChange = useCallback((enabled: boolean) => run(() => shell.setDraftSync(enabled)), [run]);
  const onGuideChange = useCallback(async (value: WorkbenchGuideState): Promise<void> => {
    try { await setPreference('workbenchGuide', value); } catch { /* Central persistence feedback owns the failure. */ }
  }, [setPreference]);
  const refresh = useCallback(async (): Promise<void> => {
    if (typeof shell.getPreferences !== 'function') return;
    lifecycle.current++;
    try { await run(() => shell.getPreferences()); } catch { /* Central persistence feedback owns the failure. */ }
  }, [run]);
  const settings: PreferenceSyncSettingsState = { snapshot, onFollowingChange, onLayoutModeChange, onDraftSyncChange };
  return { snapshot, ready: snapshot !== null, completionNotifications: snapshot?.values.completionNotifications ?? localNotifications,
    onCompletionNotifications, settings, onGuideChange, refresh };
}
