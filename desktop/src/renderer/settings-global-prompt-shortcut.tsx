import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { GlobalPromptShortcutCopy } from '../shared/global-prompt-shortcut-copy';
import { GLOBAL_PROMPT_SHORTCUT_KEYS, displayGlobalPromptShortcut, parseGlobalPromptShortcut,
  type GlobalPromptShortcutError, type GlobalPromptShortcutState } from '../shared/global-prompt-shortcut';
import { ipcErrorCode } from '../shared/ipc-error';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';
import { shell } from './shell-api';

const MODIFIERS = ['Control', 'Super', 'Alt', 'Shift'] as const;
const SETTINGS_COMMANDS = new Set(['open-settings', 'open-display-settings', 'open-data-settings', 'open-drive-diagnostics']);
interface ShortcutForm { readonly modifiers: readonly string[]; readonly key: string }
function formFrom(accelerator: string | null): ShortcutForm {
  const parts = accelerator?.replace('Command', 'Super').split('+') ?? [''];
  return { key: parts.pop()!, modifiers: parts };
}
function formValue(form: ShortcutForm): string {
  return [...MODIFIERS.filter(key => form.modifiers.includes(key)), form.key].join('+');
}
function failureText(copy: GlobalPromptShortcutCopy, error: GlobalPromptShortcutError): string {
  return { invalid: copy.globalShortcutInvalid, conflict: copy.globalShortcutConflict,
    unavailable: copy.globalShortcutUnavailable, save_failed: copy.globalShortcutSaveFailed }[error];
}

export interface SettingsGlobalPromptShortcutProps {
  readonly copy: DesktopCopy & GlobalPromptShortcutCopy;
  readonly disabled?: boolean;
  readonly isMac?: boolean;
  readonly resetKey?: number;
  readonly onFeedback?: (message: string) => void;
}

export function SettingsGlobalPromptShortcut(props: SettingsGlobalPromptShortcutProps): React.JSX.Element {
  const { copy } = props;
  const isMac = props.isMac ?? /Mac/.test(navigator.platform);
  const [state, setState] = useState<GlobalPromptShortcutState | null>(null);
  const [draft, setDraft] = useState<ShortcutForm | null>(null);
  const [reading, setReading] = useState(true), [readFailed, setReadFailed] = useState(false);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const sequence = useRef(0), mounted = useRef(false), inFlight = useRef(false);
  const focusAfter = useRef<Element | null>(null);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const latest = useRef(props); latest.current = props;
  const form = draft ?? formFrom(state?.accelerator ?? null);
  const dirty = draft !== null && formValue(draft) !== formValue(formFrom(state?.accelerator ?? null));
  const navigationState = useRef({ dirty, saving }); navigationState.current = { dirty, saving };
  const candidate = parseGlobalPromptShortcut(formValue(form), isMac);
  const current = (ticket: number) => mounted.current && ticket === sequence.current;
  const read = async (): Promise<void> => {
    const ticket = ++sequence.current;
    focusAfter.current = null;
    inFlight.current = false; setReading(true); setReadFailed(false); setState(null); setDraft(null); setNotice(''); setSaving(false);
    try {
      const next = await shell.globalPromptShortcutState();
      if (current(ticket)) setState(next);
    } catch { if (current(ticket)) setReadFailed(true); }
    finally { if (current(ticket)) setReading(false); }
  };
  useEffect(() => {
    mounted.current = true; void read();
    return () => { mounted.current = false; sequence.current++; pendingNavigation.current = null; };
  }, [props.resetKey]);
  useEffect(() => registerDecisionNavigationGuard((action, intent) => {
    if (pendingNavigation.current || navigationState.current.saving) return;
    if (!navigationState.current.dirty || (intent?.kind === 'command' && SETTINGS_COMMANDS.has(intent.id))) { action(); return; }
    pendingNavigation.current = action; setLeaveOpen(true);
  }), []);
  useEffect(() => {
    if (!dirty) { pendingNavigation.current = null; setLeaveOpen(false); }
  }, [dirty]);
  useEffect(() => {
    if (saving || !focusAfter.current) return;
    const target = focusAfter.current; focusAfter.current = null;
    // Native Chromium blurs a button when its fieldset is disabled. Keep any explicit new focus.
    if (document.activeElement !== document.body && document.activeElement !== target) return;
    if (document.getElementById('global-prompt-shortcut-title')?.closest('[hidden],[inert]')) return;
    const usable = target.isConnected && !target.matches(':disabled');
    (usable ? target as HTMLElement : document.getElementById('global-prompt-shortcut-title'))?.focus();
  }, [saving, state, notice]);
  const discard = () => { setDraft(null); setNotice(''); };
  const save = async (accelerator: string | null): Promise<void> => {
    if (inFlight.current || latest.current.disabled || !state || reading) return;
    focusAfter.current = document.activeElement;
    inFlight.current = true; setSaving(true); setNotice('');
    const ticket = ++sequence.current;
    try {
      const next = await shell.setGlobalPromptShortcut(accelerator);
      if (!current(ticket)) return;
      setState(next);
      if (!next.error) setDraft(null);
      const text = next.error ? failureText(copy, next.error) : next.activeAccelerator
        ? formatCopy(copy.globalShortcutActive, { shortcut: displayGlobalPromptShortcut(next.activeAccelerator, isMac) }) : copy.globalShortcutDisabled;
      setNotice(text); latest.current.onFeedback?.(text);
    } catch (failure) {
      if (!current(ticket)) return;
      const text = ipcErrorCode(failure) === 'operation_busy' ? copy.globalShortcutBusy : copy.globalShortcutSaveFailed;
      setNotice(text); latest.current.onFeedback?.(text);
    } finally { if (current(ticket)) { inFlight.current = false; setSaving(false); } }
  };
  const status = state?.activeAccelerator
    ? formatCopy(copy.globalShortcutActive, { shortcut: displayGlobalPromptShortcut(state.activeAccelerator, isMac) })
    : state?.accelerator ? formatCopy(copy.globalShortcutInactive, { shortcut: displayGlobalPromptShortcut(state.accelerator, isMac) })
      : copy.globalShortcutDisabled;
  const blocked = !!props.disabled || saving || reading || !state;
  const feedback = notice || (state?.error ? failureText(copy, state.error) : '');
  return <section className="settings-card settings-display settings-global-shortcut" aria-labelledby="global-prompt-shortcut-title" aria-busy={reading || saving}>
    <h2 id="global-prompt-shortcut-title" tabIndex={-1}>{copy.globalShortcutTitle}</h2>
    <p>{copy.globalShortcutDescription}</p>
    <form onSubmit={event => { event.preventDefault(); if (candidate && (dirty || state?.status === 'unavailable')) void save(candidate); }}>
      <fieldset disabled={blocked} aria-describedby="global-prompt-shortcut-hint">
        <legend>{copy.globalShortcutCombination}</legend>
        <p id="global-prompt-shortcut-hint">{copy.globalShortcutHint}</p>
        <div className="settings-display-options">
          {MODIFIERS.map(key => <label key={key}><input type="checkbox" value={key} checked={form.modifiers.includes(key)} onChange={event => {
            setDraft({ ...form, modifiers: event.target.checked ? [...form.modifiers, key] : form.modifiers.filter(value => value !== key) }); setNotice('');
          }} /><span>{key === 'Control' ? 'Ctrl' : key === 'Super' ? isMac ? '⌘ Command' : 'Windows / Super' : key === 'Alt' && isMac ? 'Option' : key}</span></label>)}
        </div>
        <label className="settings-shortcut-key" htmlFor="global-prompt-shortcut-key">{copy.globalShortcutKey}
          <select id="global-prompt-shortcut-key" className="settings-control" value={form.key} onChange={event => { setDraft({ ...form, key: event.target.value }); setNotice(''); }}>
            <option value="">{copy.globalShortcutChooseKey}</option>
            {GLOBAL_PROMPT_SHORTCUT_KEYS.map(key => <option key={key} value={key}>{key === 'Space' ? copy.globalShortcutSpace : key}</option>)}
          </select>
        </label>
        <div className="settings-actions">
          <button type="submit" className="settings-control" disabled={!candidate || (!dirty && state?.status !== 'unavailable')}>{saving ? copy.settingsWorking : copy.globalShortcutSave}</button>
          <button type="button" className="settings-control" disabled={!state?.accelerator && !state?.error} onClick={() => void save(null)}>{copy.globalShortcutOff}</button>
          {dirty ? <button type="button" className="settings-control" onClick={discard}>{copy.cancel}</button> : null}
        </div>
      </fieldset>
    </form>
    <p id="global-prompt-shortcut-status" className="settings-control-hint">{reading ? copy.globalShortcutLoading : readFailed ? copy.globalShortcutReadFailed : status}</p>
    {readFailed ? <button type="button" data-shortcut-retry className="settings-control" onClick={() => void read()}>{copy.globalShortcutRetry}</button> : null}
    {feedback ? <p className="settings-control-hint" role={props.onFeedback ? undefined : 'status'}>{feedback}</p> : null}
    {leaveOpen && dirty ? createPortal(<ConfirmDialog copy={copy} title={copy.globalShortcutLeaveTitle} message={copy.globalShortcutLeaveMessage}
      cancelLabel={copy.globalShortcutKeepEditing} confirmLabel={copy.globalShortcutDiscard}
      onCancel={() => { pendingNavigation.current = null; setLeaveOpen(false); }} onConfirm={() => {
        const action = pendingNavigation.current; pendingNavigation.current = null; setLeaveOpen(false); discard(); action?.();
      }} />, document.body) : null}
  </section>;
}
