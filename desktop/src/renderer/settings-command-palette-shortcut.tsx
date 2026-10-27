import { useEffect, useRef, useState } from 'react';
import type { DesktopCopy } from '../shared/copy';
import type { CommandPaletteShortcutMode, CommandPaletteShortcutState } from '../shared/command-palette-shortcut';
import { commandAccelerator } from '../shared/commands';
import { describeCommandPaletteShortcutError } from '../shared/status-copy';
import { ipcErrorCode } from '../shared/ipc-error';
import { useCommandPaletteShortcut } from './use-command-palette-shortcut';
import { useFailedActionFocus } from './use-failed-action-focus';
import { shortcutLabel } from './shortcut-label';
import { shell } from './shell-api';

export function SettingsCommandPaletteShortcut(props: {
  copy: DesktopCopy; isMac: boolean; disabled: boolean; resetKey?: number; onFeedback?(message: string): void;
}): React.JSX.Element {
  const { copy } = props;
  const source = useCommandPaletteShortcut();
  const [saved, setSaved] = useState<CommandPaletteShortcutState | null>(null);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const sequence = useRef(0), inFlight = useRef(false), reset = useRef(props.resetKey);
  const state = saved && saved.revision > (source.state?.revision ?? -1) ? saved : source.state;
  const latest = useRef({ props, state }); latest.current = { props, state };
  const beginFocus = useFailedActionFocus(saving);
  useEffect(() => { setNotice(''); }, [state?.revision]);
  useEffect(() => {
    if (reset.current !== props.resetKey) {
      reset.current = props.resetKey; sequence.current++; inFlight.current = false;
      setSaved(null); setSaving(false); setNotice(''); void source.refresh();
    }
    return () => { sequence.current++; };
  }, [props.resetKey]);
  const save = async (mode: CommandPaletteShortcutMode) => {
    if (inFlight.current || latest.current.props.disabled || !latest.current.state) return;
    const ticket = ++sequence.current, revision = latest.current.state.revision, finishFocus = beginFocus();
    inFlight.current = true; setSaving(true); setNotice('');
    try {
      const next = await shell.setCommandPaletteShortcut(mode);
      if (ticket !== sequence.current || next.revision < (latest.current.state?.revision ?? -1)) return;
      setSaved(next); finishFocus(!!next.error);
      if (next.error) {
        const message = describeCommandPaletteShortcutError(copy, next.error);
        setNotice(message); latest.current.props.onFeedback?.(message);
      }
    } catch (error) {
      if (ticket !== sequence.current || (latest.current.state?.revision ?? -1) > revision) return;
      finishFocus(true);
      const message = ipcErrorCode(error) === 'operation_busy' ? copy.operationBusy : copy.commandShortcutSaveFailed;
      setNotice(message); latest.current.props.onFeedback?.(message);
    } finally { if (ticket === sequence.current) { inFlight.current = false; setSaving(false); } }
  };
  const feedback = notice || (state?.error ? describeCommandPaletteShortcutError(copy, state.error) : '');
  return <section className="settings-card settings-command-shortcut" aria-labelledby="command-palette-shortcut-title" aria-busy={saving || (!state && !source.readFailed)}>
    <h2 id="command-palette-shortcut-title" tabIndex={-1}>{copy.commandShortcutTitle}</h2>
    <p>{copy.commandShortcutDescription}</p>
    <label className="settings-shortcut-key" htmlFor="command-palette-shortcut">{copy.commandShortcutCombination}
    <select id="command-palette-shortcut" className="settings-control" value={state?.mode ?? 'standard'}
      disabled={props.disabled || saving || !state} onChange={event => void save(event.target.value as CommandPaletteShortcutMode)}>
      {(['standard', 'obsidian'] as const).map(mode => <option key={mode} value={mode}>
        {shortcutLabel(commandAccelerator('open-command-palette', props.isMac ? 'darwin' : 'win32', mode)!, props.isMac)}
      </option>)}
    </select></label>
    {state?.mode === 'obsidian' ? <p data-command-shortcut-conflict className="settings-control-hint">{copy.commandShortcutConflict}</p> : null}
    {!state ? <p className="settings-control-hint">{source.readFailed ? copy.commandShortcutReadFailed : copy.commandShortcutLoading}</p> : null}
    {source.readFailed ? <button type="button" className="settings-control" data-command-shortcut-retry onClick={() => void source.refresh()}>{copy.globalShortcutRetry}</button> : null}
    {feedback ? <p className="settings-control-hint" role={props.onFeedback ? undefined : 'status'}>{feedback}</p> : null}
  </section>;
}
