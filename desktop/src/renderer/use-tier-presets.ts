import { useEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteKey } from '../shared/contracts';
import { ipcErrorCode } from '../shared/ipc-error';
import type { PreferenceSnapshot } from '../shared/preferences';
import { compareSyncVersion } from '../shared/sync';
import { presetKey, isTierPreset, type PresetMode, type TierPreset, type TierPresetCatalog } from '../shared/tier-presets';
import { shell } from './shell-api';

export interface PresetDraft { readonly model: string; readonly effort: string | null | undefined }
type PresetAction = 'refresh' | 'model' | 'current' | 'save' | 'reset';
interface PresetOperation { readonly kind: PresetAction; readonly mode?: PresetMode }
interface PresetNotice { readonly mode?: PresetMode; readonly text: string; readonly tone: 'progress' | 'success' | 'error' }
export interface TierPresetSettingsProps {
  readonly copy: DesktopCopy; readonly snapshot?: PreferenceSnapshot | null; readonly disabled?: boolean;
  readonly resetKey?: number; readonly onFeedback?: (message: string) => void;
}
const MODES = ['fast', 'think'] as const;
const values = (snapshot: PreferenceSnapshot | null | undefined, site: SiteKey) => ({
  fast: snapshot?.values[presetKey(site, 'fast')] ?? null, think: snapshot?.values[presetKey(site, 'think')] ?? null
});
export const sameDraft = (a: PresetDraft | null, b: PresetDraft | null) => a === b || !!a && !!b && a.model === b.model && a.effort === b.effort;
function failureText(copy: DesktopCopy, error: unknown, kind: PresetAction): string {
  switch (ipcErrorCode(error)) {
    case 'no_view': case 'not_ready': return copy.presetOpenSite;
    case 'operation_busy': case 'preset_busy': return copy.presetBusy;
    case 'preset_unavailable': return copy.presetUnavailable;
    case 'preset_restore_failed': return copy.presetRestoreFailed;
    case 'preset_model_switch_required': return copy.presetModelSwitchRequired;
    case 'timeout': return copy.presetTimedOut;
    case 'source_changed': return copy.presetChanged;
    default: return kind === 'reset' ? copy.presetResetFailed : kind === 'save' ? copy.presetSaveFailed : copy.presetReadFailed;
  }
}

export function useTierPresets(props: TierPresetSettingsProps, site: SiteKey = 'claude') {
  const [saved, setSaved] = useState(() => values(props.snapshot, site));
  const [drafts, setDrafts] = useState<Record<PresetMode, PresetDraft | null>>(saved);
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [catalogs, setCatalogs] = useState(new Map<string, TierPresetCatalog>());
  const [pending, setPending] = useState<PresetOperation | null>(null), [notice, setNotice] = useState<PresetNotice | null>(null);
  const latest = useRef(props); latest.current = props;
  const activeSite = useRef(site); activeSite.current = site;
  const savedRef = useRef(saved), draftRef = useRef(drafts); savedRef.current = saved; draftRef.current = drafts;
  const sequence = useRef(0), mounted = useRef(false), inFlight = useRef(false);
  const focusAfter = useRef<{ target: Element | null; mode?: PresetMode } | null>(null);
  const current = (ticket: number) => mounted.current && sequence.current === ticket && activeSite.current === site;
  useEffect(() => {
    mounted.current = true; sequence.current++; inFlight.current = false; focusAfter.current = null;
    const next = values(latest.current.snapshot, site); savedRef.current = next; draftRef.current = next;
    setSaved(next); setDrafts(next); setModels(null); setCatalogs(new Map()); setPending(null); setNotice(null);
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
    const { target, mode } = focusAfter.current; focusAfter.current = null;
    if (document.activeElement !== document.body && document.activeElement !== target) return;
    const title = document.getElementById('tier-presets-title');
    if (title?.closest('[hidden],[inert]')) return;
    const fallback = mode ? document.getElementById(`${site}-${mode}-title`) : title;
    (target?.isConnected && !target.matches(':disabled') ? target as HTMLElement : fallback)?.focus();
  }, [pending, notice]);
  const run = async (operation: PresetOperation, action: (ticket: number) => Promise<void | string>, message: string) => {
    if (inFlight.current || latest.current.disabled || !latest.current.snapshot) return;
    const ticket = ++sequence.current; inFlight.current = true;
    focusAfter.current = { target: document.activeElement, mode: operation.mode };
    const publish = (text: string, tone: PresetNotice['tone']) => {
      setNotice({ mode: operation.mode, text, tone });
      const copy = latest.current.copy;
      latest.current.onFeedback?.(operation.mode ? formatCopy(copy.presetFeedbackForMode,
        { mode: operation.mode === 'fast' ? copy.presetFast : copy.presetThink, message: text }) : text);
    };
    const copy = latest.current.copy;
    const progress = { refresh: copy.presetReading, model: copy.presetReadingModel, current: copy.presetReadingCurrent,
      save: copy.presetVerifying, reset: copy.presetResetting };
    setPending(operation); publish(progress[operation.kind], 'progress');
    try {
      const result = await action(ticket);
      if (current(ticket)) publish(result ?? message, 'success');
    } catch (error) {
      if (current(ticket)) publish(failureText(latest.current.copy, error, operation.kind), 'error');
    } finally { if (current(ticket)) { inFlight.current = false; setPending(null); } }
  };
  const refresh = () => run({ kind: 'refresh' }, async ticket => {
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
    setDrafts(draft => ({ ...draft, [mode]: model ? { model, effort: undefined } : null })); setNotice(null);
    if (!model) return;
    void run({ kind: 'model', mode }, async ticket => {
      const result = await shell.getTierPresets(site, model); if (!current(ticket)) return;
      remember(result);
      setDrafts(draft => ({ ...draft, [mode]: { model, effort: !result.efforts.length ? null :
        oldEffort && result.efforts.includes(oldEffort) ? oldEffort : undefined } }));
    }, props.copy.presetModelReady);
  };
  const chooseEffort = (mode: PresetMode, effort: string) => {
    if (inFlight.current || latest.current.disabled) return;
    setDrafts(draft => ({ ...draft, [mode]: draft[mode] ? { ...draft[mode], effort: effort || undefined } : null })); setNotice(null);
  };
  const useCurrent = (mode: PresetMode) => run({ kind: 'current', mode }, async ticket => {
    const value = await shell.getCurrentTierPreset(site); if (!current(ticket)) return;
    const result = await shell.getTierPresets(site, value.model); if (!current(ticket)) return;
    remember(result); setDrafts(draft => ({ ...draft, [mode]: value }));
    if (sameDraft(value, savedRef.current[mode])) return latest.current.copy.presetCurrentMatchesSaved;
  }, props.copy.presetCurrentDone);
  const save = (mode: PresetMode, reset = false) => {
    const value = reset ? null : draftRef.current[mode];
    if (!reset && (!isTierPreset(value) || sameDraft(value, savedRef.current[mode]) || !available(value))) return Promise.resolve();
    return run({ kind: reset ? 'reset' : 'save', mode }, async ticket => {
      const result = await shell.saveTierPreset(site, mode, value as TierPreset | null); if (!current(ticket)) return;
      const key = presetKey(site, mode), authoritative = latest.current.snapshot, newest = authoritative?.versions[key];
      if (authoritative?.deviceId !== result.deviceId || newest && compareSyncVersion(newest, result.versions[key] ?? {}) > 0)
        throw new Error('source_changed');
      const next = values(result, site); setSaved(previous => ({ ...previous, [mode]: next[mode] }));
      setDrafts(draft => ({ ...draft, [mode]: next[mode] }));
    }, reset ? props.copy.presetResetDone : props.copy.presetSaved);
  };
  const cancel = (mode?: PresetMode) => {
    setDrafts(draft => mode ? { ...draft, [mode]: savedRef.current[mode] } : savedRef.current); setNotice(null);
  };
  const available = (draft: PresetDraft | null) => !!draft && !!models?.includes(draft.model) &&
    (draft.effort === null ? catalogs.get(draft.model)?.efforts.length === 0 : typeof draft.effort === 'string' && catalogs.get(draft.model)?.efforts.includes(draft.effort));
  return { saved, drafts, models, catalogs, pending, notice, refresh, chooseModel, chooseEffort, useCurrent, save, cancel, available };
}
