import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatCopy } from '../shared/copy';
import { presetLabel } from '../shared/tier-presets';
import { ConfirmDialog } from './confirm-dialog';
import { registerDecisionNavigationGuard } from './decision-navigation';
import { sameDraft, useTierPresets, type TierPresetSettingsProps } from './use-tier-presets';

const SETTINGS_COMMANDS = new Set(['open-settings', 'open-display-settings', 'open-data-settings', 'open-drive-diagnostics']);
export function TierPresetSettings(props: TierPresetSettingsProps): React.JSX.Element {
  const { copy } = props, form = useTierPresets(props);
  const [leaveOpen, setLeaveOpen] = useState(false), navigation = useRef<(() => void) | null>(null);
  const dirty = !sameDraft(form.drafts.fast, form.saved.fast) || !sameDraft(form.drafts.think, form.saved.think);
  const latest = useRef({ dirty, saving: false }); latest.current = { dirty, saving: form.pending === 'save' };
  useEffect(() => registerDecisionNavigationGuard((action, intent) => {
    if (navigation.current || latest.current.saving) return;
    if (!latest.current.dirty || (intent?.kind === 'command' && SETTINGS_COMMANDS.has(intent.id))) { action(); return; }
    navigation.current = action; setLeaveOpen(true);
  }), []);
  useEffect(() => { if (!dirty) { navigation.current = null; setLeaveOpen(false); } }, [dirty]);
  const blocked = !!props.disabled || !!form.pending || !props.snapshot;
  return <section className="settings-card settings-display tier-presets" aria-labelledby="claude-presets-title" aria-busy={!!form.pending}>
    <h2 id="claude-presets-title" tabIndex={-1}>{copy.presetTitle}</h2>
    <p>{copy.presetDescription}</p>
    <p id="claude-presets-hint" className="settings-control-hint">{copy.presetReadHint}</p>
    <div className="settings-actions"><button type="button" className="settings-control" data-preset-action="refresh" disabled={blocked}
      onClick={() => void form.refresh()}>{form.models ? copy.presetRefreshAgain : copy.presetRefresh}</button></div>
    {(['fast', 'think'] as const).map(mode => {
      const draft = form.drafts[mode], saved = form.saved[mode], choices = draft ? form.efforts.get(draft.model) : undefined;
      const missingModel = !!draft && !!form.models && !form.models.includes(draft.model);
      const missingEffort = !!draft?.effort && !!choices && !choices.includes(draft.effort);
      const names = form.models ?? [], id = `claude-${mode}`;
      return <fieldset key={mode} data-preset-mode={mode} disabled={blocked} aria-describedby="claude-presets-hint">
        <legend>{mode === 'fast' ? copy.presetFast : copy.presetThink}</legend>
        <p className="settings-control-hint" data-preset-saved={mode}>{formatCopy(copy.presetSavedLabel, { choice: saved ? presetLabel(saved) : copy.presetRecommended })}</p>
        <div className="tier-preset-fields">
          <label htmlFor={`${id}-model`}>{copy.presetModel}<select id={`${id}-model`} className="settings-control" value={draft?.model ?? ''}
            disabled={!form.models} onChange={event => form.chooseModel(mode, event.target.value)}>
            <option value="">{copy.presetChooseModel}</option>
            {draft && !names.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
            {names.map(model => <option key={model} value={model}>{model}</option>)}
          </select></label>
          <label htmlFor={`${id}-effort`}>{copy.presetEffort}<select id={`${id}-effort`} className="settings-control" value={draft?.effort ?? ''}
            disabled={!draft || !choices?.length || missingModel} onChange={event => form.chooseEffort(mode, event.target.value)}>
            <option value="">{draft && choices?.length === 0 ? copy.presetNoEffort : copy.presetChooseEffort}</option>
            {draft?.effort && !choices?.includes(draft.effort) ? <option value={draft.effort}>{draft.effort}</option> : null}
            {choices?.map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
        </div>
        {missingModel || missingEffort ? <p className="settings-control-hint">{copy.presetChoiceUnavailable}</p> : null}
        <div className="settings-actions">
          <button type="button" className="settings-control" data-preset-action="save" disabled={!form.available(draft)} onClick={() => void form.save(mode)}>{copy.presetSave}</button>
          <button type="button" className="settings-control" data-preset-action="current" onClick={() => void form.useCurrent(mode)}>{copy.presetCurrent}</button>
          <button type="button" className="settings-control" data-preset-action="reset" disabled={!saved} onClick={() => void form.save(mode, true)}>{copy.presetReset}</button>
          {!sameDraft(draft, saved) ? <button type="button" className="settings-control" onClick={() => form.cancel(mode)}>{copy.presetCancel}</button> : null}
        </div>
      </fieldset>;
    })}
    <p id="claude-presets-status" className="settings-control-hint" role={props.onFeedback ? undefined : 'status'}>{form.pending ? copy.presetWorking : form.notice}</p>
    {leaveOpen && dirty ? createPortal(<ConfirmDialog copy={copy} title={copy.presetLeaveTitle} message={copy.presetLeaveMessage}
      cancelLabel={copy.presetKeepEditing} confirmLabel={copy.presetDiscard}
      onCancel={() => { navigation.current = null; setLeaveOpen(false); }} onConfirm={() => {
        const action = navigation.current; navigation.current = null; setLeaveOpen(false); form.cancel(); action?.();
      }} />, document.body) : null}
  </section>;
}
