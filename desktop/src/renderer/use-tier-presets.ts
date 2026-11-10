import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { SiteKey } from '../shared/contracts';
import { ipcErrorCode } from '../shared/ipc-error';
import type { PreferenceSnapshot } from '../shared/preferences';
import { compareSyncVersion } from '../shared/sync';
import { presetKey, isTierPreset, type PresetMode, type TierPreset, type TierPresetCatalog } from '../shared/tier-presets';
import { shell } from './shell-api';

export interface PresetDraft { readonly model: string; readonly effort: string | null | undefined }
export interface TierPresetSettingsProps {
  readonly copy: DesktopCopy; readonly snapshot?: PreferenceSnapshot | null; readonly disabled?: boolean;
  readonly resetKey?: number; readonly onFeedback?: (message: string) => void;
}
const MODES = ['fast', 'think'] as const;
const values = (snapshot: PreferenceSnapshot | null | undefined, site: SiteKey) => ({
  fast: snapshot?.values[presetKey(site, 'fast')] ?? null, think: snapshot?.values[presetKey(site, 'think')] ?? null
});
export const sameDraft = (a: PresetDraft | null, b: PresetDraft | null) => a === b || !!a && !!b && a.model === b.model && a.effort === b.effort;
function failureText(copy: DesktopCopy, error: unknown): string {
  switch (ipcErrorCode(error)) {
    case 'no_view': case 'not_ready': return copy.presetOpenSite;
    case 'operation_busy': case 'preset_busy': return copy.presetBusy;
    case 'preset_unavailable': return copy.presetUnavailable;
    case 'preset_restore_failed': return copy.presetRestoreFailed;
    case 'preset_model_switch_required': return copy.presetModelSwitchRequired;
    case 'timeout': return copy.presetTimedOut;
    case 'source_changed': return copy.presetChanged;
    default: return copy.presetReadFailed;
  }
}

export function useTierPresets(props: TierPresetSettingsProps, site: SiteKey = 'claude') {
  const [saved, setSaved] = useState(() => values(props.snapshot, site));
  const [drafts, setDrafts] = useState<Record<PresetMode, PresetDraft | null>>(saved);
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [catalogs, setCatalogs] = useState(new Map<string, TierPresetCatalog>());
  const [pending, setPending] = useState<'read' | 'save' | null>(null), [notice, setNotice] = useState('');
  const latest = useRef(props); latest.current = props;
  const activeSite = useRef(site); activeSite.current = site;
  const savedRef = useRef(saved), draftRef = useRef(drafts); savedRef.current = saved; draftRef.current = drafts;
  const sequence = useRef(0), mounted = useRef(false), inFlight = useRef(false), focusAfter = useRef<Element | null>(null);
  const current = (ticket: number) => mounted.current && sequence.current === ticket && activeSite.current === site;
  useEffect(() => {
    mounted.current = true; sequence.current++; inFlight.current = false; focusAfter.current = null;
    const next = values(latest.current.snapshot, site); savedRef.current = next; draftRef.current = next;
    setSaved(next); setDrafts(next); setModels(null); setCatalogs(new Map()); setPending(null); setNotice('');
    return () => { mounted.current = false; sequence.current++; };
  }, [props.resetKey, site]);
  useEffect(() => {
    const next = values(props.snapshot, site), previous = savedRef.current;
    setDrafts(draft => ({ fast: sameDraft(draft.fast, previous.fast) ? next.fast : draft.fast,
      think: sameDraft(draft.think, previous.think) ? next.think : draft.think }));
    setSaved(next);
  }, [props.snapshot, site]);
  useEffect(() => {
    if (pending || !focusAfter.current) return;
    const target = focusAfter.current; focusAfter.current = null;
    if (document.activeElement !== document.body && document.activeElement !== target) return;
    const title = document.getElementById('tier-presets-title');
    if (title?.closest('[hidden],[inert]')) return;
    (target.isConnected && !target.matches(':disabled') ? target as HTMLElement : title)?.focus();
  }, [pending, notice]);
  const run = async (kind: 'read' | 'save', action: (ticket: number) => Promise<void>, message: string) => {
    if (inFlight.current || latest.current.disabled || !latest.current.snapshot) return;
    const ticket = ++sequence.current; inFlight.current = true; focusAfter.current = document.activeElement;
    setPending(kind); setNotice(''); latest.current.onFeedback?.(latest.current.copy.presetWorking);
    try {
      await action(ticket);
      if (current(ticket)) { setNotice(message); latest.current.onFeedback?.(message); }
    } catch (error) {
      if (current(ticket)) { const text = failureText(latest.current.copy, error); setNotice(text); latest.current.onFeedback?.(text); }
    } finally { if (current(ticket)) { inFlight.current = false; setPending(null); } }
  };
  const refresh = () => run('read', async ticket => {
    const first = await shell.getTierPresets(site); if (!current(ticket)) return;
    const next = new Map<string, TierPresetCatalog>([[first.model, first]]);
    const selected = new Set(MODES.map(mode => draftRef.current[mode]?.model).filter((value): value is string => !!value));
    for (const model of selected) {
      if (!first.models.includes(model) || next.has(model)) continue;
      try {
        const result = await shell.getTierPresets(site, model); if (!current(ticket)) return;
        next.set(model, result);
      } catch (error) {
        if (!current(ticket)) return;
        if (ipcErrorCode(error) !== 'preset_model_switch_required') throw error;
      }
    }
    setModels(first.models); setCatalogs(next);
  }, props.copy.presetReadDone);
  const remember = (result: TierPresetCatalog) => {
    setModels(result.models); setCatalogs(previous => new Map(previous).set(result.model, result));
  };
  const chooseModel = (mode: PresetMode, model: string) => {
    if (inFlight.current || latest.current.disabled) return;
    const oldEffort = draftRef.current[mode]?.effort;
    setDrafts(draft => ({ ...draft, [mode]: model ? { model, effort: undefined } : null })); setNotice('');
    if (!model) return;
    void run('read', async ticket => {
      const result = await shell.getTierPresets(site, model); if (!current(ticket)) return;
      remember(result);
      setDrafts(draft => ({ ...draft, [mode]: { model, effort: !result.efforts.length ? null :
        oldEffort && result.efforts.includes(oldEffort) ? oldEffort : undefined } }));
    }, props.copy.presetReadDone);
  };
  const chooseEffort = (mode: PresetMode, effort: string) => {
    if (inFlight.current || latest.current.disabled) return;
    setDrafts(draft => ({ ...draft, [mode]: draft[mode] ? { ...draft[mode], effort: effort || undefined } : null })); setNotice('');
  };
  const useCurrent = (mode: PresetMode) => run('read', async ticket => {
    const value = await shell.getCurrentTierPreset(site); if (!current(ticket)) return;
    const result = await shell.getTierPresets(site, value.model); if (!current(ticket)) return;
    remember(result); setDrafts(draft => ({ ...draft, [mode]: value }));
  }, props.copy.presetCurrentDone);
  const save = (mode: PresetMode, reset = false) => {
    const value = reset ? null : draftRef.current[mode];
    if (!reset && !isTierPreset(value)) return Promise.resolve();
    return run('save', async ticket => {
      const result = await shell.saveTierPreset(site, mode, value as TierPreset | null); if (!current(ticket)) return;
      const key = presetKey(site, mode), authoritative = latest.current.snapshot, newest = authoritative?.versions[key];
      if (authoritative?.deviceId !== result.deviceId || newest && compareSyncVersion(newest, result.versions[key] ?? {}) > 0)
        throw new Error('source_changed');
      const next = values(result, site); setSaved(previous => ({ ...previous, [mode]: next[mode] }));
      setDrafts(draft => ({ ...draft, [mode]: next[mode] }));
    }, reset ? props.copy.presetResetDone : props.copy.presetSaved);
  };
  const cancel = (mode?: PresetMode) => {
    setDrafts(draft => mode ? { ...draft, [mode]: savedRef.current[mode] } : savedRef.current); setNotice('');
  };
  const available = (draft: PresetDraft | null) => !!draft && !!models?.includes(draft.model) &&
    (draft.effort === null ? catalogs.get(draft.model)?.efforts.length === 0 : typeof draft.effort === 'string' && catalogs.get(draft.model)?.efforts.includes(draft.effort));
  return { saved, drafts, models, catalogs, pending, notice, refresh, chooseModel, chooseEffort, useCurrent, save, cancel, available };
}
